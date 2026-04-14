// ECOM-41 | check-stock-alerts Edge Function
// Detecta produtos com estoque crítico e notifica via realtime + email
// Trigger: Cron a cada 6h ou após sync-inventory

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { getCorsHeaders, handleCors } from "../_shared/cors.ts";
import { getServiceClient } from "../_shared/supabase.ts";

serve(async (req: Request) => {
  const corsRes = handleCors(req);
  if (corsRes) return corsRes;
  const corsH = getCorsHeaders(req);

  const supabase = getServiceClient();
  let body: AlertRequest = {};
  try { body = await req.json(); } catch {}

  const orgFilter = body.organization_id;

  let orgQuery = supabase.from("organizations").select("id, name");
  if (orgFilter) orgQuery = orgQuery.eq("id", orgFilter);
  const { data: orgs } = await orgQuery.limit(100);

  const allAlerts: Alert[] = [];

  for (const org of orgs ?? []) {
    // Busca produtos com estoque baixo ou zerado
    const { data: products } = await supabase
      .from("vw_ai_inventory_status")
      .select("*")
      .eq("organization_id", org.id)
      .in("stock_status", ["out_of_stock", "critical", "low"]);

    if (!products?.length) continue;

    for (const p of products) {
      const severity = p.stock_status === "out_of_stock" ? "high"
        : p.stock_status === "critical" ? "medium" : "low";

      // Verifica se já existe alerta ativo nas últimas 24h (evita spam)
      const { data: existing } = await supabase
        .from("notifications")
        .select("id")
        .eq("organization_id", org.id)
        .eq("type", "stock_alert")
        .contains("data", { sku: p.sku })
        .gte("created_at", new Date(Date.now() - 24 * 3600000).toISOString())
        .limit(1);

      if (existing?.length) continue;

      const msg = p.stock_status === "out_of_stock"
        ? `🚨 ${p.name} está SEM ESTOQUE. Reponha urgente!`
        : p.stock_status === "critical"
        ? `⚠️ ${p.name} com apenas ${p.total_stock} unidades (crítico)`
        : `📉 ${p.name} com estoque baixo: ${p.total_stock} unidades`;

      // Cria notificação no banco
      await supabase.from("notifications").insert({
        organization_id: org.id,
        type: "stock_alert",
        title: "Alerta de Estoque",
        message: msg,
        severity,
        data: { product_name: p.name, sku: p.sku, stock: p.total_stock, status: p.stock_status },
        read: false,
      });

      allAlerts.push({
        org: org.name,
        product: p.name,
        sku: p.sku,
        stock: p.total_stock,
        status: p.stock_status,
        severity,
        message: msg,
      });
    }
  }

  return json({
    alerts_created: allAlerts.length,
    high: allAlerts.filter(a => a.severity === "high").length,
    medium: allAlerts.filter(a => a.severity === "medium").length,
    low: allAlerts.filter(a => a.severity === "low").length,
    alerts: allAlerts,
  }, 200, corsH);
});

function json(d: unknown, s: number, h: Record<string, string>) {
  return new Response(JSON.stringify(d), { status: s, headers: { ...h, "Content-Type": "application/json" } });
}
interface AlertRequest { organization_id?: string; }
interface Alert { org: string; product: string; sku: string; stock: number; status: string; severity: string; message: string; }
