// ECOM-47 | create-payment-link Edge Function
// Gera link de pagamento avulso via Stripe (checkout session pré-pago)
//
// Secrets: STRIPE_SECRET_KEY

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { getCorsHeaders, handleCors } from "../_shared/cors.ts";
import { getUserClient } from "../_shared/supabase.ts";

serve(async (req: Request) => {
  const corsRes = handleCors(req);
  if (corsRes) return corsRes;
  const corsH = getCorsHeaders(req);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Unauthorized" }, 401, corsH);

  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
  if (!stripeKey) return json({ error: "STRIPE_SECRET_KEY não configurado" }, 500, corsH);

  const userClient = getUserClient(authHeader);
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json({ error: "Sessão inválida" }, 401, corsH);

  let body: PaymentLinkRequest;
  try { body = await req.json(); } catch { return json({ error: "JSON inválido" }, 400, corsH); }

  const { description, amount_cents, customer_email, expiry_hours = 72 } = body;
  if (!description || !amount_cents || amount_cents < 100) {
    return json({ error: "description e amount_cents (mínimo 100) são obrigatórios" }, 400, corsH);
  }

  const expiresAt = Math.floor((Date.now() + expiry_hours * 3600 * 1000) / 1000);

  // Cria checkout session no Stripe
  const formData = new URLSearchParams({
    "mode": "payment",
    "line_items[0][price_data][currency]": "brl",
    "line_items[0][price_data][product_data][name]": description,
    "line_items[0][price_data][unit_amount]": String(amount_cents),
    "line_items[0][quantity]": "1",
    "success_url": "https://e-conomia.vercel.app/contabil?payment=success",
    "cancel_url": "https://e-conomia.vercel.app/contabil?payment=cancelled",
    "expires_at": String(expiresAt),
    ...(customer_email ? { "customer_email": customer_email } : {}),
    "payment_method_types[0]": "card",
    "payment_method_types[1]": "boleto",
    "metadata[source]": "e-conomia-crm",
    "metadata[user_id]": user.id,
  });

  const stripeRes = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${stripeKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: formData.toString(),
  });

  const stripeData = await stripeRes.json();

  if (!stripeRes.ok) {
    return json({ error: "Erro Stripe", details: stripeData.error?.message }, 502, corsH);
  }

  return json({
    payment_url: stripeData.url,
    session_id: stripeData.id,
    expires_at: new Date(expiresAt * 1000).toISOString(),
    amount_brl: (amount_cents / 100).toFixed(2),
  }, 200, corsH);
});

function json(d: unknown, s: number, h: Record<string, string>) {
  return new Response(JSON.stringify(d), { status: s, headers: { ...h, "Content-Type": "application/json" } });
}

interface PaymentLinkRequest {
  description: string;
  amount_cents: number;
  customer_email?: string;
  expiry_hours?: number;
}
