// ECOM-38 | generate-label Edge Function
// Gera etiqueta de envio via Melhor Envio (compra + download PDF)
// Fluxo: 1. Adiciona ao carrinho ME → 2. Gera pedido de frete → 3. Retorna PDF URL
//
// Secrets necessários:
//   MELHOR_ENVIO_TOKEN  — token Melhor Envio (sandbox ou produção)
//   MELHOR_ENVIO_ENV    — "sandbox" | "production" (default: sandbox)

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { getCorsHeaders, handleCors } from "../_shared/cors.ts";
import { getServiceClient } from "../_shared/supabase.ts";

const ME_BASE = {
  sandbox: "https://sandbox.melhorenvio.com.br/api/v2/me",
  production: "https://melhorenvio.com.br/api/v2/me",
};

serve(async (req: Request) => {
  const corsRes = handleCors(req);
  if (corsRes) return corsRes;
  const corsH = getCorsHeaders(req);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Unauthorized" }, 401, corsH);

  const token = Deno.env.get("MELHOR_ENVIO_TOKEN");
  const env = (Deno.env.get("MELHOR_ENVIO_ENV") ?? "sandbox") as "sandbox" | "production";
  const base = ME_BASE[env];

  if (!token) return json({ error: "MELHOR_ENVIO_TOKEN não configurado" }, 500, corsH);

  let body: LabelRequest;
  try {
    body = await req.json();
  } catch {
    return json({ error: "JSON inválido" }, 400, corsH);
  }

  const { order_id, service_id, from, to, products } = body;
  if (!order_id || !service_id || !from || !to || !products?.length) {
    return json({
      error: "order_id, service_id, from (cep+nome+endereço), to (cep+nome+endereço) e products são obrigatórios"
    }, 400, corsH);
  }

  const headers = {
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json",
    "Accept": "application/json",
    "User-Agent": "E-conomia CRM (suporte@e-conomia.com.br)",
  };

  // 1. Adiciona ao carrinho
  const cartRes = await fetch(`${base}/shipment/cart`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      service: service_id,
      from: {
        name: from.name,
        phone: from.phone ?? "",
        email: from.email ?? "",
        company_document: from.cnpj ?? "",
        address: from.address,
        complement: from.complement ?? "",
        number: from.number ?? "S/N",
        district: from.district ?? "",
        city: from.city,
        state_abbr: from.state,
        postal_code: from.cep.replace(/\D/g, ""),
      },
      to: {
        name: to.name,
        phone: to.phone ?? "",
        email: to.email ?? "",
        document: to.cpf ?? "",
        address: to.address,
        complement: to.complement ?? "",
        number: to.number ?? "S/N",
        district: to.district ?? "",
        city: to.city,
        state_abbr: to.state,
        postal_code: to.cep.replace(/\D/g, ""),
        is_residential: true,
      },
      products: products.map((p) => ({
        name: p.name ?? "Produto",
        quantity: p.quantity ?? 1,
        unitary_value: p.value ?? 0,
        weight: p.weight ?? 0.3,
        width: p.width ?? 11,
        height: p.height ?? 17,
        length: p.length ?? 11,
      })),
      options: {
        insurance_value: products.reduce((s: number, p: any) => s + (p.value ?? 0) * (p.quantity ?? 1), 0),
        receipt: false,
        own_hand: false,
        collect: false,
        reverse: false,
        non_commercial: false,
      },
      invoice: { key: body.nfe_key ?? "" },
    }),
  });

  if (!cartRes.ok) {
    const err = await cartRes.text();
    return json({ error: "Erro ao adicionar ao carrinho ME", details: err }, 502, corsH);
  }

  const cartData = await cartRes.json();
  const cartId = cartData.id;

  // 2. Confirma o pedido (compra a etiqueta)
  const orderRes = await fetch(`${base}/shipment/order`, {
    method: "POST",
    headers,
    body: JSON.stringify({ orders: [cartId] }),
  });

  if (!orderRes.ok) {
    const err = await orderRes.text();
    return json({ error: "Erro ao confirmar pedido ME", details: err }, 502, corsH);
  }

  // 3. Gera o PDF da etiqueta
  const printRes = await fetch(`${base}/shipment/print`, {
    method: "POST",
    headers,
    body: JSON.stringify({ mode: "public", orders: [cartId] }),
  });

  if (!printRes.ok) {
    const err = await printRes.text();
    return json({ error: "Erro ao gerar etiqueta PDF", details: err }, 502, corsH);
  }

  const printData = await printRes.json();
  const labelUrl: string = printData.url ?? printData.link ?? "";

  // 4. Atualiza order no banco com tracking e status
  const supabase = getServiceClient();
  await supabase.from("orders").update({
    shipping_label_status: "printed",
    tracking_code: cartData.tracking ?? null,
  }).eq("id", order_id);

  return json({
    success: true,
    label_url: labelUrl,
    tracking_code: cartData.tracking ?? null,
    cart_id: cartId,
    env,
  }, 200, corsH);
});

function json(data: unknown, status: number, corsH: Record<string, string>) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsH, "Content-Type": "application/json" },
  });
}

interface LabelRequest {
  order_id: string;
  service_id: number;
  nfe_key?: string;
  from: Address;
  to: Address;
  products: Product[];
}

interface Address {
  name: string; cep: string; address: string;
  number?: string; complement?: string; district?: string;
  city: string; state: string;
  phone?: string; email?: string;
  cnpj?: string; cpf?: string;
}

interface Product {
  name?: string; quantity?: number; value?: number;
  weight?: number; width?: number; height?: number; length?: number;
}
