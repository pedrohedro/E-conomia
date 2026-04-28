// ECOM-41 + ECOM-91 | check-stock-alerts Edge Function
// Detecta estoque crítico + alertas preditivos de stockout por velocidade de venda

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { getCorsHeaders, handleCors } from "../_shared/cors.ts";
import { getServiceClient } from "../_shared/supabase.ts";

const PREDICTIVE_DAYS_THRESHOLD = 7; // Alerta se vai zerar em menos de 7 dias
const VELOCITY_WINDOW_DAYS = 14;     // Calcula velocidade dos últimos 14 dias

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
    // ─── 1. Alertas de estoque atual crítico/zerado ───────────────────────────
    const { data: products } = await supabase
      .from("vw_ai_inventory_status")
      .select("*")
      .eq("organization_id", org.id)
      .in("stock_status", ["out_of_stock", "critical", "low"]);

    // SKUs já alertados em "current" — usados para deduplicar predictive abaixo
    const currentlyAlertedSkus = new Set<string>();

    for (const p of products ?? []) {
      const severity = p.stock_status === "out_of_stock" ? "high"
        : p.stock_status === "critical" ? "medium" : "low";

      currentlyAlertedSkus.add(p.sku);

      if (await recentAlertExists(supabase, org.id, "stock_alert", p.sku, 24)) continue;

      const msg = p.stock_status === "out_of_stock"
        ? `${p.name} está SEM ESTOQUE. Reponha urgente!`
        : p.stock_status === "critical"
        ? `${p.name} com apenas ${p.total_stock} unidades (crítico)`
        : `${p.name} com estoque baixo: ${p.total_stock} unidades`;

      await supabase.from("notifications").insert({
        organization_id: org.id,
        type: "stock_alert",
        title: "Alerta de Estoque",
        message: msg,
        severity,
        data: { product_name: p.name, sku: p.sku, stock: p.total_stock, status: p.stock_status },
        read: false,
      });

      allAlerts.push({ org: org.name, product: p.name, sku: p.sku, stock: p.total_stock, status: p.stock_status, severity, message: msg, type: "current" });
    }

    // ─── 2. Alertas preditivos: calcula velocidade e projeta stockout ─────────
    const velocityFrom = new Date(Date.now() - VELOCITY_WINDOW_DAYS * 86400000).toISOString();

    const { data: movements } = await supabase
      .from("stock_movements")
      .select("product_id, quantity, created_at")
      .eq("organization_id", org.id)
      .eq("movement_type", "sale")
      .gte("created_at", velocityFrom);

    if (!movements?.length) continue;

    // Agrupa vendas por produto
    const salesByProduct: Record<string, number> = {};
    for (const m of movements) {
      if (!m.product_id) continue;
      salesByProduct[m.product_id] = (salesByProduct[m.product_id] || 0) + Math.abs(m.quantity);
    }

    // Calcula dias restantes para cada produto com venda
    for (const [productId, totalSold] of Object.entries(salesByProduct)) {
      const avgDailySales = totalSold / VELOCITY_WINDOW_DAYS;
      if (avgDailySales < 0.1) continue; // Produto quase sem movimento, ignora

      // Busca estoque atual (somar disponível em todos os canais)
      const { data: stockRows } = await supabase
        .from("channel_stock")
        .select("available, products(name, sku)")
        .eq("organization_id", org.id)
        .eq("product_id", productId);

      if (!stockRows?.length) continue;

      const totalAvailable = stockRows.reduce((s, r) => s + (r.available ?? 0), 0);
      if (totalAvailable <= 0) continue; // já está em out_of_stock — current alert cobre

      const daysUntilStockout = totalAvailable / avgDailySales;
      if (daysUntilStockout >= PREDICTIVE_DAYS_THRESHOLD) continue;

      const firstProduct = (stockRows[0].products as any) ?? {};
      const productName = firstProduct.name ?? productId;
      const sku         = firstProduct.sku  ?? productId;

      // Dedupe: se já há current alert para este SKU, não dispara predictive duplicado
      if (currentlyAlertedSkus.has(sku)) continue;

      if (await recentAlertExists(supabase, org.id, "predictive_stockout", sku, 12)) continue;

      const severity = daysUntilStockout < 2 ? "high" : daysUntilStockout < 4 ? "medium" : "low";
      const daysText = daysUntilStockout < 1 ? "menos de 1 dia" : `~${Math.round(daysUntilStockout)} dias`;
      const msg = `${productName} pode zerar em ${daysText} (${avgDailySales.toFixed(1)} vendas/dia)`;

      await supabase.from("notifications").insert({
        organization_id: org.id,
        type: "predictive_stockout",
        title: "Alerta Preditivo de Stockout",
        message: msg,
        severity,
        data: {
          product_name: productName,
          sku,
          current_stock: totalAvailable,
          avg_daily_sales: parseFloat(avgDailySales.toFixed(2)),
          days_until_stockout: parseFloat(daysUntilStockout.toFixed(1)),
        },
        read: false,
      });

      allAlerts.push({
        org: org.name,
        product: productName,
        sku,
        stock: totalAvailable,
        status: "predictive",
        severity,
        message: msg,
        type: "predictive",
        days_until_stockout: parseFloat(daysUntilStockout.toFixed(1)),
        avg_daily_sales: parseFloat(avgDailySales.toFixed(2)),
      });
    }
  }

  return json({
    alerts_created: allAlerts.length,
    high: allAlerts.filter(a => a.severity === "high").length,
    medium: allAlerts.filter(a => a.severity === "medium").length,
    low: allAlerts.filter(a => a.severity === "low").length,
    current_stock_alerts: allAlerts.filter(a => a.type === "current").length,
    predictive_alerts: allAlerts.filter(a => a.type === "predictive").length,
    alerts: allAlerts,
  }, 200, corsH);
});

async function recentAlertExists(
  supabase: ReturnType<typeof getServiceClient>,
  orgId: string,
  type: string,
  sku: string,
  hoursAgo: number
): Promise<boolean> {
  const { data } = await supabase
    .from("notifications")
    .select("id")
    .eq("organization_id", orgId)
    .eq("type", type)  // notifications.type (correto)
    .contains("data", { sku })
    .gte("created_at", new Date(Date.now() - hoursAgo * 3600000).toISOString())
    .limit(1);
  return (data?.length ?? 0) > 0;
}

function json(d: unknown, s: number, h: Record<string, string>) {
  return new Response(JSON.stringify(d), { status: s, headers: { ...h, "Content-Type": "application/json" } });
}

interface AlertRequest { organization_id?: string; }
interface Alert {
  org: string; product: string; sku: string; stock: number; status: string;
  severity: string; message: string; type: "current" | "predictive";
  days_until_stockout?: number; avg_daily_sales?: number;
}
