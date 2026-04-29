// ECOM-77 | reconcile-stock Edge Function
// Sincroniza estoque local vs ML: detecta e corrige divergências
// ML Full → ML é source of truth; Flex/Próprio → local pode empurrar via push-stock-to-ml

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { getCorsHeaders, handleCors } from "../_shared/cors.ts";
import { getServiceClient } from "../_shared/supabase.ts";

const ML_API = "https://api.mercadolibre.com";
const MAX_DIVERGENCES = 500;

serve(async (req: Request) => {
  const corsRes = handleCors(req);
  if (corsRes) return corsRes;
  const corsH = getCorsHeaders(req);

  const supabase = getServiceClient();
  let body: { organization_id?: string; dry_run?: boolean; strategy?: string } = {};
  try { body = await req.json(); } catch {}

  const url = new URL(req.url);
  const strategy = body.strategy || url.searchParams.get("strategy") || "incremental"; // incremental | full
  const dryRun = body.dry_run === true || url.searchParams.get("dry_run") === "true";

  let intQuery = supabase
    .from("marketplace_integrations")
    .select("id, organization_id, seller_id, access_token, marketplace")
    .eq("status", "active")
    .eq("marketplace", "mercado_livre");

  if (body.organization_id) intQuery = intQuery.eq("organization_id", body.organization_id);

  const { data: integrations, error: intErr } = await intQuery;
  if (intErr) return json({ error: intErr.message }, 500, corsH);

  const results: ReconcileResult[] = [];

  for (const integration of integrations ?? []) {
    const logId = crypto.randomUUID();
    if (!dryRun) {
      await supabase.from("sync_logs").insert({
        id: logId,
        integration_id: integration.id,
        organization_id: integration.organization_id,
        event_type: "stock_reconciliation",
        status: "started",
        started_at: new Date().toISOString(),
      });
    }

    try {
      const result = await reconcileForIntegration(supabase, integration, dryRun, strategy);
      results.push(result);

      if (!dryRun) {
        await supabase.from("sync_logs").update({
          status: "success",
          records_processed: result.divergences_found,
          error_message: result.divergences_found > 0
            ? `${result.fixed} fixes, ${result.skipped} skipped`
            : null,
          finished_at: new Date().toISOString(),
        }).eq("id", logId);
      }
    } catch (err) {
      console.error(`[reconcile] Error for integration ${integration.id}:`, err);
      if (!dryRun) {
        await supabase.from("sync_logs").update({
          status: "error",
          error_message: String(err),
          finished_at: new Date().toISOString(),
        }).eq("id", logId);
      }
      results.push({
        integration_id: integration.id,
        organization_id: integration.organization_id,
        divergences_found: 0,
        fixed: 0,
        skipped: 0,
        dry_run: dryRun,
        error: String(err),
      });
    }
  }

  return json({
    total_integrations: results.length,
    total_divergences: results.reduce((s, r) => s + r.divergences_found, 0),
    total_fixed: results.reduce((s, r) => s + r.fixed, 0),
    dry_run: dryRun,
    results,
  }, 200, corsH);
});

async function reconcileForIntegration(
  supabase: ReturnType<typeof getServiceClient>,
  integration: Record<string, any>,
  dryRun: boolean,
  strategy: string
): Promise<ReconcileResult> {
  const orgId = integration.organization_id;
  const sellerId = integration.seller_id;
  const token = integration.access_token;

  let query = supabase
    .from("channel_stock")
    .select("id, product_id, channel_sku, available, reserved, channel, products(name, sku), last_synced_at")
    .eq("organization_id", orgId)
    .in("channel", ["ml_full", "ml_flex"])
    .not("channel_sku", "is", null);

  if (strategy === "incremental") {
    // Busca os 100 itens mais antigos/não sincronizados
    query = query.order("last_synced_at", { ascending: true, nullsFirst: true }).limit(100);
  } else {
    // Full sync limite
    query = query.limit(MAX_DIVERGENCES);
  }

  const { data: localStocks } = await query;

  if (!localStocks?.length) {
    return { integration_id: integration.id, organization_id: orgId, divergences_found: 0, fixed: 0, skipped: 0, dry_run: dryRun };
  }

  let divergencesFound = 0;
  let fixed = 0;
  let skipped = 0;
  const divergenceDetails: DivergenceDetail[] = [];

  // Busca em lote de 20 items por vez para não sobrecarregar ML API
  const chunkSize = 20;
  for (let i = 0; i < localStocks.length; i += chunkSize) {
    const chunk = localStocks.slice(i, i + chunkSize);
    const mlIds = chunk.map(s => s.channel_sku).join(",");

    const mlRes = await fetchWithRetry(
      `${ML_API}/items?ids=${encodeURIComponent(mlIds)}&attributes=id,available_quantity,status,listing_type_id`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (!mlRes.ok) {
      console.warn(`[reconcile] ML API error for chunk starting at ${i}: ${mlRes.status}`);
      continue;
    }

    const mlItems: Array<{ code: number; body: { id: string; available_quantity: number; status: string; listing_type_id: string } }> = await mlRes.json();

    for (const mlItem of mlItems) {
      if (mlItem.code !== 200 || !mlItem.body) continue;

      const mlId = mlItem.body.id;
      const mlQty = mlItem.body.available_quantity ?? 0;
      const localEntry = chunk.find(s => s.channel_sku === mlId);
      if (!localEntry) continue;

      const localQty = localEntry.available ?? 0;

      if (localQty === mlQty) continue; // sem divergência

      divergencesFound++;
      const isFull = localEntry.channel === "ml_full";
      const diff = Math.abs(mlQty - localQty);

      divergenceDetails.push({
        channel_sku: mlId,
        local_qty: localQty,
        ml_qty: mlQty,
        fulfillment_type: localEntry.channel,
        product_name: (localEntry.products as any)?.name ?? mlId,
        action: isFull ? "update_local" : "skip_push_needed",
      });

      if (dryRun) continue;

      if (isFull) {
        // ML Full: ML é source of truth — atualiza quantity local (available é gerado)
        const newQuantity = mlQty + (localEntry.reserved ?? 0);
        const { error: updErr } = await supabase
          .from("channel_stock")
          .update({ quantity: newQuantity, updated_at: new Date().toISOString() })
          .eq("id", localEntry.id);

        if (!updErr) {
          // Registra movimento de reconciliação
          await supabase.from("stock_movements").insert({
            organization_id: orgId,
            product_id: localEntry.product_id,
            movement_type: "adjustment",
            quantity: mlQty - localQty,
            channel: "ml_full",
            notes: `Reconciliação ML Full: ML=${mlQty} Local era=${localQty}`,
          });
          fixed++;
        } else {
          skipped++;
        }
      } else {
        // Flex/Próprio: log como divergência, não aplica automaticamente (usuário decide)
        const { error: notifErr } = await supabase.from("notifications").insert({
          organization_id: orgId,
          type: "stock_divergence",
          title: "Divergência de Estoque Detectada",
          message: `${(localEntry.products as any)?.name ?? mlId}: Local=${localQty} vs ML=${mlQty} (${localEntry.channel})`,
          severity: (diff > 5 || (diff / Math.max(localQty, 1)) > 0.1) ? "high" : "medium",
          data: {
            channel_sku: mlId,
            local_qty: localQty,
            ml_qty: mlQty,
            channel: localEntry.channel,
          },
          read: false,
        });
        if (!notifErr) fixed++; else skipped++;
      }
    }

    // Atualiza last_synced_at para os itens checados
    if (!dryRun) {
      const idsToUpdate = chunk.map(c => c.id);
      await supabase.from("channel_stock")
        .update({ last_synced_at: new Date().toISOString() })
        .in("id", idsToUpdate);
    }

    // Rate limit: 200ms entre chunks
    await new Promise(r => setTimeout(r, 200));
  }

  return {
    integration_id: integration.id,
    organization_id: orgId,
    divergences_found: divergencesFound,
    fixed,
    skipped,
    dry_run: dryRun,
    details: divergenceDetails.slice(0, 50), // max 50 no response
  };
}

async function fetchWithRetry(url: string, init: RequestInit, retries = 3): Promise<Response> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    try {
      const res = await fetch(url, { ...init, signal: ctrl.signal });
      clearTimeout(timer);
      if (res.status === 429) {
        await new Promise(r => setTimeout(r, 2000 * attempt));
        continue;
      }
      return res;
    } catch (err) {
      clearTimeout(timer);
      if (attempt === retries) throw err;
      await new Promise(r => setTimeout(r, 1000 * attempt));
    }
  }
  throw new Error("Max retries exceeded");
}

function json(d: unknown, s: number, h: Record<string, string>) {
  return new Response(JSON.stringify(d), { status: s, headers: { ...h, "Content-Type": "application/json" } });
}

interface ReconcileResult {
  integration_id: string;
  organization_id: string;
  divergences_found: number;
  fixed: number;
  skipped: number;
  dry_run: boolean;
  error?: string;
  details?: DivergenceDetail[];
}

interface DivergenceDetail {
  channel_sku: string;
  local_qty: number;
  ml_qty: number;
  fulfillment_type: string;
  product_name: string;
  action: string;
}
