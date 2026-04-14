// ECOM-36 | emit-nfe Edge Function
// Emissão de NF-e via Focus NFe API (sandbox + produção)
// Docs: https://focusnfe.com.br/doc/
//
// Secrets necessários:
//   FOCUSNFE_TOKEN  — token de acesso (sandbox ou produção)
//   FOCUSNFE_ENV    — "sandbox" | "production" (default: sandbox)

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { getCorsHeaders, handleCors } from "../_shared/cors.ts";
import { getServiceClient, getUserClient } from "../_shared/supabase.ts";

const FOCUS_BASE = {
  sandbox: "https://homologacao.focusnfe.com.br/v2",
  production: "https://api.focusnfe.com.br/v2",
};

serve(async (req: Request) => {
  const corsRes = handleCors(req);
  if (corsRes) return corsRes;
  const corsH = getCorsHeaders(req);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return json({ error: "Unauthorized" }, 401, corsH);
  }

  const token = Deno.env.get("FOCUSNFE_TOKEN");
  const env = (Deno.env.get("FOCUSNFE_ENV") ?? "sandbox") as "sandbox" | "production";
  const baseUrl = FOCUS_BASE[env] ?? FOCUS_BASE.sandbox;

  if (!token) {
    return json({ error: "FOCUSNFE_TOKEN não configurado nos Secrets do Supabase" }, 500, corsH);
  }

  let body: EmitRequest;
  try {
    body = await req.json();
  } catch {
    return json({ error: "JSON inválido" }, 400, corsH);
  }

  const { order_id } = body;
  if (!order_id) {
    return json({ error: "order_id é obrigatório" }, 400, corsH);
  }

  // Busca o pedido com itens e customer
  const supabase = getServiceClient();
  const { data: order, error: orderErr } = await supabase
    .from("orders")
    .select(`
      *,
      customers (*),
      order_items (*)
    `)
    .eq("id", order_id)
    .single();

  if (orderErr || !order) {
    return json({ error: "Pedido não encontrado", details: orderErr?.message }, 404, corsH);
  }

  if (order.nfe_status === "authorized") {
    return json({ error: "NF-e já emitida para este pedido", nfe_number: order.nfe_number }, 409, corsH);
  }

  // Monta o payload padrão NF-e (NFC-e / NF-e simplificada para e-commerce)
  const refNfe = `econ_${order_id.slice(0, 22).replace(/-/g, "")}`;
  const customer = order.customers;
  const items = order.order_items ?? [];

  if (!items.length) {
    return json({ error: "Pedido sem itens para emitir NF-e" }, 422, corsH);
  }

  // Valor total da nota
  const totalNota = order.gross_amount ?? 0;

  const nfePayload = {
    natureza_operacao: "Venda de Mercadoria",
    data_emissao: new Date().toISOString().slice(0, 19) + "-03:00",
    tipo_documento: 1, // 1=Saída
    finalidade_emissao: 1, // 1=Normal
    consumidor_final: 1,
    presenca_comprador: 2, // 2=Operação não presencial (internet)
    // Emitente (dados mockados/exemplo — usuário deve configurar nos settings)
    cnpj_emitente: Deno.env.get("EMPRESA_CNPJ") ?? "00000000000100",
    nome_emitente: Deno.env.get("EMPRESA_NOME") ?? "Empresa Exemplo LTDA",
    nome_fantasia_emitente: Deno.env.get("EMPRESA_FANTASIA") ?? "E-conomia",
    // Destinatário
    ...(customer?.cpf_cnpj
      ? { cpf_destinatario: customer.cpf_cnpj }
      : { email_destinatario: customer?.email ?? "destinatario@exemplo.com" }),
    nome_destinatario: customer?.name ?? "NF-e Consumidor Final",
    email_destinatario: customer?.email ?? "",
    // Itens
    items: items.map((item: any, idx: number) => ({
      numero_item: idx + 1,
      codigo_produto: item.sku ?? `PROD-${idx + 1}`,
      descricao: item.product_name ?? "Produto",
      cfop: "6102", // Venda de mercadoria p/ fora do estado (e-commerce)
      unidade_comercial: "UN",
      quantidade_comercial: item.quantity ?? 1,
      valor_unitario_comercial: item.unit_price ?? 0,
      valor_bruto: (item.unit_price ?? 0) * (item.quantity ?? 1),
      ncm: "84713012", // NCM genérico placeholder — usuário deve especificar por produto
      icms_situacao_tributaria: "400", // Isento
      pis_situacao_tributaria: "07",   // Operação isenta de contribuição
      cofins_situacao_tributaria: "07",
    })),
    // Totais
    icms_total: {
      base_calculo: 0,
      valor: 0,
      base_calculo_st: 0,
      valor_st: 0,
      valor_total_produtos: totalNota,
      valor_frete: order.shipping_cost ?? 0,
      valor_seguro: 0,
      valor_desconto: order.discount_amount ?? 0,
      valor_ii: 0,
      valor_ipi: 0,
      valor_pis: 0,
      valor_cofins: 0,
      valor_outras_despesas: 0,
      valor_total: totalNota,
    },
    // Transporte (e-commerce: sem veículo próprio)
    modalidade_frete: 1, // 1=Contratação pelo Destinatário
    informacoes_adicionais_contribuinte: `Pedido #${order.order_number} via ${order.marketplace}`,
  };

  // Envia para Focus NFe
  const focusRes = await fetch(`${baseUrl}/nfe?ref=${encodeURIComponent(refNfe)}`, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${btoa(token + ":")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(nfePayload),
  });

  const focusData = await focusRes.json();

  if (!focusRes.ok && focusRes.status !== 201) {
    console.error("Focus NFe error:", focusData);
    await supabase.from("orders").update({ nfe_status: "error" }).eq("id", order_id);
    return json({ error: "Erro na emissão", details: focusData }, 502, corsH);
  }

  // Salva referência no banco
  await supabase.from("orders").update({
    nfe_status: "processing",
    nfe_number: focusData.numero ?? null,
  }).eq("id", order_id);

  return json({
    success: true,
    status: focusData.status ?? "processing",
    ref: refNfe,
    nfe_number: focusData.numero,
    message: env === "sandbox"
      ? "NF-e enviada para homologação (sandbox). Use FOCUSNFE_ENV=production para emissão real."
      : "NF-e em processamento na SEFAZ.",
  }, 200, corsH);
});

// ─── helpers ─────────────────────────────────────────────────────────────────

function json(data: unknown, status: number, corsH: Record<string, string>) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsH, "Content-Type": "application/json" },
  });
}

interface EmitRequest {
  order_id: string;
}
