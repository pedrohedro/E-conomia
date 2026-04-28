import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { getCorsHeaders, handleCors } from "../_shared/cors.ts";
import { getServiceClient } from "../_shared/supabase.ts";

// ============================================================================
// push-stock-to-ml — Sync Bidirecional Local → ML (ECOM-79)
// Chamada quando vendedor ajusta estoque localmente.
// Envia novo quantity para o anúncio via PUT /items/{id}
//
// Payload: { organization_id, product_id, channel_sku, quantity }
// ============================================================================

const ML_API = "https://api.mercadolibre.com";

serve(async (req: Request) => {
  const corsRes = handleCors(req);
  if (corsRes) return corsRes;

  const corsH = getCorsHeaders(req);

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405, corsH);
  }

  const body = await req.json().catch(() => null);
  if (!body) return json({ error: "Invalid JSON" }, 400, corsH);

  const { organization_id, product_id, channel_sku, quantity } = body;

  if (!organization_id || !channel_sku || quantity == null) {
    return json({ error: "organization_id, channel_sku e quantity são obrigatórios" }, 400, corsH);
  }

  const supabase = getServiceClient();

  // Busca token de acesso ML da organização
  const { data: integration, error: intErr } = await supabase
    .from("marketplace_integrations")
    .select("id, access_token, seller_id, token_expires_at")
    .eq("organization_id", organization_id)
    .eq("marketplace", "mercado_livre")
    .eq("status", "active")
    .order("updated_at", { ascending: false })
    .limit(1)
    .single();

  if (intErr || !integration) {
    return json({ error: "Integração ML não encontrada ou inativa" }, 404, corsH);
  }

  // Verifica se o token não expirou (margem de 5 min)
  if (integration.token_expires_at) {
    const expiresAt = new Date(integration.token_expires_at).getTime();
    if (Date.now() > expiresAt - 5 * 60 * 1000) {
      return json({ error: "Token ML expirado. Reconecte a integração." }, 401, corsH);
    }
  }

  // ML só permite atualizar estoque próprio (flex/seller), não Full (gerenciado pelo CD)
  const { data: cs } = await supabase
    .from("channel_stock")
    .select("channel")
    .eq("organization_id", organization_id)
    .eq("channel_sku", channel_sku)
    .single();

  if (cs?.channel === "ml_full") {
    return json({
      error: "Estoque Full é gerenciado pelo CD do ML e não pode ser alterado via API.",
      hint: "Para repor estoque Full, envie mercadorias ao CD do ML.",
    }, 422, corsH);
  }

  // Envia para ML com retry e rate limit handling
  let lastError: string | null = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`${ML_API}/items/${channel_sku}`, {
        method: "PUT",
        headers: {
          "Authorization": `Bearer ${integration.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ available_quantity: Math.max(0, quantity) }),
      });

      if (res.status === 429) {
        // Rate limit — backoff exponencial
        await sleep(2000 * attempt);
        continue;
      }

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        lastError = `ML API ${res.status}: ${errBody.message ?? JSON.stringify(errBody)}`;
        if (res.status === 401) break; // Token inválido — não retenta
        await sleep(1000 * attempt);
        continue;
      }

      const mlItem = await res.json();

      // Atualiza channel_stock local para refletir confirmação do ML
      await supabase
        .from("channel_stock")
        .update({
          quantity: mlItem.available_quantity ?? quantity,
          updated_at: new Date().toISOString(),
        })
        .eq("organization_id", organization_id)
        .eq("channel_sku", channel_sku);

      // Atualiza stock_locations
      if (product_id) {
        await supabase
          .from("stock_locations")
          .update({
            quantity: mlItem.available_quantity ?? quantity,
            last_synced_at: new Date().toISOString(),
            sync_source: "push",
          })
          .eq("organization_id", organization_id)
          .eq("product_id", product_id)
          .in("location_type", ["flex_origin", "seller_warehouse"]);
      }

      // Log de movimentação
      if (product_id) {
        await supabase.from("stock_movements").insert({
          organization_id,
          product_id,
          channel: cs?.channel ?? "ml_flex",
          movement_type: "adjustment",
          quantity: mlItem.available_quantity ?? quantity,
          notes: `Ajuste enviado ao ML — item ${channel_sku}`,
        });
      }

      // Log de sync
      await supabase.from("sync_logs").insert({
        integration_id: integration.id,
        organization_id,
        event_type: "push_stock_ml",
        status: "completed",
        metadata: { channel_sku, new_quantity: mlItem.available_quantity ?? quantity, attempt },
      });

      return json({
        success: true,
        channel_sku,
        quantity_confirmed: mlItem.available_quantity ?? quantity,
        attempt,
      }, 200, corsH);

    } catch (err) {
      lastError = String(err);
      await sleep(1000 * attempt);
    }
  }

  // Falhou após retries — loga o erro
  await supabase.from("sync_logs").insert({
    integration_id: integration.id,
    organization_id,
    event_type: "push_stock_ml",
    status: "failed",
    error_message: lastError,
    metadata: { channel_sku, quantity },
  });

  return json({ error: lastError ?? "Falha ao atualizar estoque no ML" }, 500, corsH);
});

function json(d: unknown, s: number, h: Record<string, string>) {
  return new Response(JSON.stringify(d), {
    status: s,
    headers: { ...h, "Content-Type": "application/json" },
  });
}

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}
