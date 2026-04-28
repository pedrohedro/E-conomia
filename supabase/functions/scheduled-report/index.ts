// ECOM-40 | scheduled-report Edge Function
// Gera e envia relatório diário/semanal de vendas via email (Resend API)
// Trigger: Supabase Cron toda terça/sexta 18h ou manualmente
//
// Secrets: RESEND_API_KEY, GEMINI_API_KEY

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { getCorsHeaders, handleCors } from "../_shared/cors.ts";
import { getServiceClient } from "../_shared/supabase.ts";

const RESEND_URL = "https://api.resend.com/emails";
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

serve(async (req: Request) => {
  const corsRes = handleCors(req);
  if (corsRes) return corsRes;
  const corsH = getCorsHeaders(req);

  const supabase = getServiceClient();
  const resendKey = Deno.env.get("RESEND_API_KEY");
  const geminiKey = Deno.env.get("GEMINI_API_KEY");

  let body: ReportRequest = {};
  try { body = await req.json(); } catch { /* GET = cron trigger */ }

  const orgFilter = body.organization_id;

  // Busca organizações ativas com integrações
  let query = supabase
    .from("organizations")
    .select("id, name, marketplace_integrations(id, marketplace, status)");
  if (orgFilter) query = query.eq("id", orgFilter);

  const { data: orgs } = await query.limit(50);
  if (!orgs?.length) return json({ message: "Nenhuma org encontrada" }, 200, corsH);

  const results = [];

  for (const org of orgs) {
    try {
      // Dados dos últimos 7 dias
      const since = new Date(Date.now() - 7 * 86400000).toISOString();
      const [salesRes, topRes, stockRes] = await Promise.all([
        supabase.from("vw_ai_sales_summary")
          .select("*").eq("organization_id", org.id)
          .gte("sale_date", since.slice(0, 10))
          .order("sale_date", { ascending: false }),
        supabase.from("vw_ai_top_products")
          .select("*").eq("organization_id", org.id).limit(5),
        supabase.from("vw_ai_inventory_status")
          .select("*").eq("organization_id", org.id)
          .in("stock_status", ["out_of_stock", "critical"]).limit(10),
      ]);

      const sales = salesRes.data ?? [];
      const topProducts = topRes.data ?? [];
      const criticalStock = stockRes.data ?? [];

      const totalRevenue = sales.reduce((s: number, r: any) => s + (r.gross_revenue ?? 0), 0);
      const totalOrders = sales.reduce((s: number, r: any) => s + (r.orders ?? 0), 0);
      const totalFees = sales.reduce((s: number, r: any) => s + (r.fees ?? 0), 0);

      // Gera análise com Gemini
      let aiInsight = "";
      if (geminiKey && sales.length > 0) {
        const prompt = `Você é analista de e-commerce. Analise esses dados dos últimos 7 dias e dê 2-3 insights práticos em português (máximo 100 palavras):
Receita: R$${totalRevenue.toFixed(2)} | Pedidos: ${totalOrders} | Taxas: R$${totalFees.toFixed(2)}
Top produto: ${topProducts[0]?.product_name ?? "N/A"} (${topProducts[0]?.units_sold ?? 0} unidades)
Estoque crítico: ${criticalStock.length} produtos`;

        const gRes = await fetch(`${GEMINI_URL}?key=${geminiKey}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.4, maxOutputTokens: 150 },
          }),
        });
        const gData = await gRes.json();
        aiInsight = gData.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
      }

      // Busca email do dono da org
      const { data: member } = await supabase
        .from("org_members")
        .select("users:user_id(email)")
        .eq("organization_id", org.id)
        .eq("role", "owner")
        .single();

      const email = (member?.users as any)?.email;
      if (!email || !resendKey) {
        results.push({ org: org.name, status: "skipped", reason: "no email or resend key" });
        continue;
      }

      // Monta HTML do email
      const emailHtml = buildEmailHtml({
        orgName: org.name,
        totalRevenue,
        totalOrders,
        totalFees,
        topProducts,
        criticalStock,
        aiInsight,
        period: "últimos 7 dias",
      });

      // Envia via Resend
      const sendRes = await fetch(RESEND_URL, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${resendKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "E-conomia AI <relatorios@e-conomia.com.br>",
          to: [email],
          subject: `📊 Relatório ${org.name} — ${new Date().toLocaleDateString("pt-BR")}`,
          html: emailHtml,
        }),
      });

      const sendData = await sendRes.json();
      results.push({ org: org.name, status: sendRes.ok ? "sent" : "error", id: sendData.id });
    } catch (err) {
      results.push({ org: org.name, status: "error", error: String(err) });
    }
  }

  return json({ sent: results.filter((r: any) => r.status === "sent").length, results }, 200, corsH);
});

function buildEmailHtml(data: EmailData): string {
  const fmtCurrency = (v: number) => `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
  body{font-family:'Inter',sans-serif;background:#0f1117;color:#e2e8f0;margin:0;padding:0}
  .container{max-width:560px;margin:0 auto;padding:32px 16px}
  .header{background:linear-gradient(135deg,#6366f1,#8b5cf6);border-radius:12px;padding:24px;text-align:center;margin-bottom:24px}
  .header h1{margin:0;font-size:22px;color:#fff}
  .header p{margin:4px 0 0;font-size:13px;color:rgba(255,255,255,.7)}
  .kpi-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:20px}
  .kpi{background:#1a1d2e;border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:16px;text-align:center}
  .kpi-val{font-size:18px;font-weight:700;color:#a5b4fc}
  .kpi-label{font-size:11px;color:#64748b;margin-top:4px}
  .section{background:#1a1d2e;border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:16px;margin-bottom:16px}
  .section h3{margin:0 0 12px;font-size:13px;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em}
  .product-row{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(255,255,255,.04);font-size:13px}
  .alert{background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.2);border-radius:8px;padding:10px 14px;font-size:13px;color:#fca5a5;margin-bottom:8px}
  .ai-box{background:linear-gradient(135deg,rgba(99,102,241,.1),rgba(139,92,246,.1));border:1px solid rgba(99,102,241,.2);border-radius:10px;padding:16px;margin-bottom:16px}
  .ai-box h3{margin:0 0 8px;font-size:13px;color:#a5b4fc}
  .ai-box p{margin:0;font-size:13px;line-height:1.6;color:#cbd5e1}
  .footer{text-align:center;font-size:11px;color:#334155;margin-top:24px}
</style></head>
<body><div class="container">
  <div class="header">
    <h1>📊 Relatório Semanal</h1>
    <p>${data.orgName} · ${data.period}</p>
  </div>
  <div class="kpi-grid">
    <div class="kpi"><div class="kpi-val">${fmtCurrency(data.totalRevenue)}</div><div class="kpi-label">Receita Bruta</div></div>
    <div class="kpi"><div class="kpi-val">${data.totalOrders}</div><div class="kpi-label">Pedidos</div></div>
    <div class="kpi"><div class="kpi-val">${fmtCurrency(data.totalFees)}</div><div class="kpi-label">Taxas</div></div>
  </div>
  ${data.aiInsight ? `<div class="ai-box"><h3>🤖 Análise E-conomia AI</h3><p>${data.aiInsight.replace(/\n/g, '<br>')}</p></div>` : ''}
  <div class="section">
    <h3>🏆 Top Produtos</h3>
    ${data.topProducts.slice(0, 5).map((p: any) => `
      <div class="product-row">
        <span>${p.product_name}</span>
        <span style="color:#a5b4fc">${p.units_sold} un · ${fmtCurrency(parseFloat(p.revenue))}</span>
      </div>`).join('') || '<p style="color:#64748b;font-size:13px">Sem dados disponíveis</p>'}
  </div>
  ${data.criticalStock.length > 0 ? `
  <div class="section">
    <h3>⚠️ Estoque Crítico</h3>
    ${data.criticalStock.map((p: any) => `<div class="alert">📦 ${p.name} — ${p.total_stock} unidades (${p.stock_status === 'out_of_stock' ? 'SEM ESTOQUE' : 'CRÍTICO'})</div>`).join('')}
  </div>` : ''}
  <div class="footer">E-conomia CRM · <a href="https://e-conomia.vercel.app" style="color:#6366f1">Acessar plataforma</a></div>
</div></body></html>`;
}

function json(data: unknown, status: number, corsH: Record<string, string>) {
  return new Response(JSON.stringify(data), {
    status, headers: { ...corsH, "Content-Type": "application/json" },
  });
}

interface ReportRequest { organization_id?: string; }
interface EmailData {
  orgName: string; totalRevenue: number; totalOrders: number;
  totalFees: number; topProducts: any[]; criticalStock: any[];
  aiInsight: string; period: string;
}
