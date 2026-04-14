// ECOM-37 | quote-freight Edge Function
// Cotação de frete via Melhor Envio API v2
// Docs: https://docs.melhorenvio.com.br/reference/cotação-de-frete

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { getCorsHeaders, handleCors } from "../_shared/cors.ts";
import { getUserClient } from "../_shared/supabase.ts";

const ME_API = "https://melhorenvio.com.br/api/v2";
const ME_TOKEN = Deno.env.get("MELHOR_ENVIO_TOKEN");

serve(async (req: Request) => {
  const corsRes = handleCors(req);
  if (corsRes) return corsRes;
  const corsH = getCorsHeaders(req);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsH, "Content-Type": "application/json" },
    });
  }

  if (!ME_TOKEN) {
    return new Response(JSON.stringify({ error: "MELHOR_ENVIO_TOKEN not configured" }), {
      status: 500, headers: { ...corsH, "Content-Type": "application/json" },
    });
  }

  let body: QuoteRequest;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400, headers: { ...corsH, "Content-Type": "application/json" },
    });
  }

  const { from_postal_code, to_postal_code, products } = body;

  if (!from_postal_code || !to_postal_code || !products?.length) {
    return new Response(
      JSON.stringify({ error: "from_postal_code, to_postal_code e products são obrigatórios" }),
      { status: 400, headers: { ...corsH, "Content-Type": "application/json" } }
    );
  }

  const mePayload = {
    from: { postal_code: from_postal_code.replace(/\D/g, "") },
    to: { postal_code: to_postal_code.replace(/\D/g, "") },
    products: products.map((p) => ({
      id: p.id ?? "produto",
      width: p.width ?? 11,
      height: p.height ?? 17,
      length: p.length ?? 11,
      weight: p.weight ?? 0.3,
      insurance_value: p.insurance_value ?? 0,
      quantity: p.quantity ?? 1,
    })),
    options: {
      receipt: false,
      own_hand: false,
      collect: false,
    },
    services: body.services ?? "1,2,3,4,7,8", // Correios PAC, SEDEX + transportadoras
  };

  const meRes = await fetch(`${ME_API}/me/shipment/calculate`, {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json",
      "Authorization": `Bearer ${ME_TOKEN}`,
      "User-Agent": "E-conomia CRM (suporte@e-conomia.com.br)",
    },
    body: JSON.stringify(mePayload),
  });

  if (!meRes.ok) {
    const err = await meRes.text();
    console.error("Melhor Envio error:", err);
    return new Response(JSON.stringify({ error: "Erro na cotação", details: err }), {
      status: 502, headers: { ...corsH, "Content-Type": "application/json" },
    });
  }

  const quotes: MEQuote[] = await meRes.json();

  // Filtrar apenas quotes com preço e formatar
  const available = quotes
    .filter((q) => !q.error && q.price != null)
    .map((q) => ({
      id: q.id,
      name: q.name,
      company: q.company?.name ?? q.name,
      logo: q.company?.picture ?? null,
      price: parseFloat(q.price ?? "0"),
      delivery_time: q.delivery_time,
      delivery_range: q.delivery_range,
      currency: "BRL",
    }))
    .sort((a, b) => a.price - b.price);

  return new Response(JSON.stringify({ quotes: available }), {
    status: 200,
    headers: { ...corsH, "Content-Type": "application/json" },
  });
});

interface QuoteRequest {
  from_postal_code: string;
  to_postal_code: string;
  products: {
    id?: string;
    width?: number;
    height?: number;
    length?: number;
    weight?: number;
    insurance_value?: number;
    quantity?: number;
  }[];
  services?: string;
}

interface MEQuote {
  id: number;
  name: string;
  price?: string;
  error?: string;
  delivery_time?: number;
  delivery_range?: { min: number; max: number };
  company?: { name: string; picture?: string };
}
