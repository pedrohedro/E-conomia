// ECOM-39 | ai-chat Edge Function
// Assistente AI que responde perguntas em português sobre os dados da conta
// Usa Google Gemini API com contexto dos dados reais do Supabase
//
// Secrets necessários:
//   GEMINI_API_KEY  — Google AI Studio → https://aistudio.google.com/app/apikey

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { getCorsHeaders, handleCors } from "../_shared/cors.ts";
import { getServiceClient, getUserClient } from "../_shared/supabase.ts";

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

serve(async (req: Request) => {
  const corsRes = handleCors(req);
  if (corsRes) return corsRes;
  const corsH = getCorsHeaders(req);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Unauthorized" }, 401, corsH);

  const geminiKey = Deno.env.get("GEMINI_API_KEY");
  if (!geminiKey) return json({ error: "GEMINI_API_KEY não configurado" }, 500, corsH);

  let body: ChatRequest;
  try { body = await req.json(); }
  catch { return json({ error: "JSON inválido" }, 400, corsH); }

  const { question, organization_id } = body;
  if (!question?.trim() || !organization_id) {
    return json({ error: "question e organization_id são obrigatórios" }, 400, corsH);
  }

  // Verifica sessão do usuário
  const userClient = getUserClient(authHeader);
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json({ error: "Sessão inválida" }, 401, corsH);

  const supabase = getServiceClient();

  // ─── 1. Coleta contexto de dados (paralelo) ─────────────────────────────────
  const [salesRes, topProductsRes, inventoryRes, ordersRes] = await Promise.all([
    supabase.from("vw_ai_sales_summary")
      .select("*")
      .eq("organization_id", organization_id)
      .order("sale_date", { ascending: false })
      .limit(30),
    supabase.from("vw_ai_top_products")
      .select("*")
      .eq("organization_id", organization_id)
      .limit(10),
    supabase.from("vw_ai_inventory_status")
      .select("*")
      .eq("organization_id", organization_id)
      .limit(20),
    supabase.from("orders")
      .select("status, gross_amount, marketplace, marketplace_created_at")
      .eq("organization_id", organization_id)
      .gte("marketplace_created_at", new Date(Date.now() - 7 * 86400000).toISOString())
      .limit(50),
  ]);

  const salesData = salesRes.data ?? [];
  const topProducts = topProductsRes.data ?? [];
  const inventory = inventoryRes.data ?? [];
  const recentOrders = ordersRes.data ?? [];

  // Totais rápidos para contexto
  const today = new Date().toISOString().slice(0, 10);
  const todaySales = salesData.filter(s => s.sale_date === today);
  const todayRevenue = todaySales.reduce((sum, s) => sum + (s.gross_revenue ?? 0), 0);
  const todayOrders = todaySales.reduce((sum, s) => sum + (s.orders ?? 0), 0);

  const last7Revenue = recentOrders.reduce((sum, o) => sum + (o.gross_amount ?? 0), 0);
  const last7Orders = recentOrders.length;

  const outOfStock = inventory.filter(i => i.stock_status === "out_of_stock").length;
  const criticalStock = inventory.filter(i => i.stock_status === "critical").length;

  // ─── 2. Busca histórico da conversa (últimas 6 mensagens) ───────────────────
  const { data: history } = await supabase
    .from("ai_chat_history")
    .select("role, content")
    .eq("organization_id", organization_id)
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(6);

  const historyMessages = (history ?? []).reverse().map(m => ({
    role: m.role === "user" ? "user" : "model",
    parts: [{ text: m.content }],
  }));

  // ─── 3. System prompt com dados reais ───────────────────────────────────────
  const systemContext = `Você é o **E-conomia AI**, assistente especializado em e-commerce brasileiro.
Você analisa dados reais do negócio e responde em português de forma direta, profissional e acionável.

## DADOS ATUAIS DO NEGÓCIO (${new Date().toLocaleDateString("pt-BR")}):

### Resumo de Hoje
- Pedidos hoje: ${todayOrders}
- Receita hoje: R$ ${todayRevenue.toFixed(2)}

### Últimos 7 Dias
- Total de pedidos: ${last7Orders}
- Receita bruta: R$ ${last7Revenue.toFixed(2)}

### Estoque
- Produtos sem estoque: ${outOfStock}
- Estoque crítico (≤5 un): ${criticalStock}

### Top 10 Produtos (últimos 30 dias)
${topProducts.map((p, i) => `${i + 1}. ${p.product_name} — ${p.units_sold} un vendidas, R$ ${parseFloat(p.revenue).toFixed(2)}`).join("\n") || "Sem dados"}

### Vendas por Dia (últimos 30 dias)
${salesData.slice(0, 14).map(s => `${s.sale_date} | ${s.marketplace} | ${s.orders} pedidos | R$ ${parseFloat(s.gross_revenue).toFixed(2)}`).join("\n") || "Sem dados"}

### Estoque Crítico
${inventory.filter(i => i.stock_status !== "ok").slice(0, 10).map(i => `- ${i.name}: ${i.total_stock} un (${i.stock_status})`).join("\n") || "Nenhum produto em estado crítico"}

## REGRAS:
- Responda SEMPRE em português brasileiro
- Seja direto e inclua números quando disponível
- Se não tiver dados suficientes, diga claramente
- Use formatação markdown (negrito, listas) para legibilidade
- Nunca invente dados que não estão no contexto acima
- Máximo 300 palavras por resposta`;

  // ─── 4. Chama Gemini ────────────────────────────────────────────────────────
  const geminiPayload = {
    system_instruction: { parts: [{ text: systemContext }] },
    contents: [
      ...historyMessages,
      { role: "user", parts: [{ text: question }] },
    ],
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 512,
      topP: 0.8,
    },
    safetySettings: [
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
    ],
  };

  const geminiRes = await fetch(`${GEMINI_URL}?key=${geminiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(geminiPayload),
  });

  if (!geminiRes.ok) {
    const err = await geminiRes.text();
    console.error("Gemini error:", err);
    return json({ error: "Erro na API Gemini", details: err }, 502, corsH);
  }

  const geminiData = await geminiRes.json();
  const answer = geminiData.candidates?.[0]?.content?.parts?.[0]?.text
    ?? "Desculpe, não consegui processar sua pergunta. Tente novamente.";

  // ─── 5. Persiste pergunta + resposta no histórico ───────────────────────────
  await supabase.from("ai_chat_history").insert([
    { organization_id, user_id: user.id, role: "user", content: question },
    {
      organization_id, user_id: user.id, role: "assistant", content: answer,
      metadata: {
        today_orders: todayOrders,
        today_revenue: todayRevenue,
        last7_orders: last7Orders,
      }
    },
  ]);

  return json({ answer, question }, 200, corsH);
});

function json(data: unknown, status: number, corsH: Record<string, string>) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsH, "Content-Type": "application/json" },
  });
}

interface ChatRequest {
  question: string;
  organization_id: string;
}
