// ============================================================================
// marketplace-callback — GET endpoint que recebe o callback OAuth
// ============================================================================
// Fluxo: Marketplace redireciona aqui → valida state → troca code por token
//        → salva integração no DB → 302 redirect → app/?connected=marketplace
//
// Query params (variam por marketplace):
//   marketplace  (obrigatório em todos)
//   state        (anti-CSRF, todos exceto Shopee)
//   code         (authorization code)
//   --- Shopee ---
//   shop_id      (ID da loja Shopee)
//   --- Amazon ---
//   spapi_oauth_code     (code da Amazon)
//   selling_partner_id   (seller ID)
//   --- Shopify ---
//   hmac, shop, timestamp (verificação HMAC obrigatória)
// ============================================================================

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { getServiceClient } from "../_shared/supabase.ts";

const APP_URL = () => Deno.env.get("APP_URL") ?? "https://e-conomia.vercel.app";

serve(async (req: Request) => {
  // Callback é sempre GET (redirect do marketplace)
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200 });
  }

  const url = new URL(req.url);
  const marketplace = url.searchParams.get("marketplace");

  if (!marketplace) {
    return redirect(`${APP_URL()}/?error=${enc("Marketplace não identificado no callback")}`);
  }

  const supabase = getServiceClient();

  try {
    switch (marketplace) {
      case "shopee":
        return await handleShopeeCallback(url, supabase);
      case "amazon":
        return await handleAmazonCallback(url, supabase);
      case "bling":
        return await handleBlingCallback(url, supabase);
      case "shopify":
        return await handleShopifyCallback(url, supabase);
      case "tiktok_shop":
        return await handleTikTokCallback(url, supabase);
      case "mercado_livre":
        return await handleMLCallback(url, supabase);
      case "nuvemshop":
        return await handleNuvemshopCallback(url, supabase);
      default:
        return redirect(`${APP_URL()}/?error=${enc("Marketplace desconhecido: " + marketplace)}`);
    }
  } catch (err) {
    console.error(`[callback][${marketplace}] Error:`, err);
    return redirect(`${APP_URL()}/?error=${enc("Erro ao conectar " + marketplace + ": " + String(err).slice(0, 100))}`);
  }
});

// ─── Validação de State (anti-CSRF) ─────────────────────────────────────────

async function validateState(supabase: any, state: string | null): Promise<{ org_id: string; user_id: string; shop?: string } | null> {
  if (!state) return null;

  const { data, error } = await supabase
    .from("oauth_states")
    .select("organization_id, user_id, shop, expires_at")
    .eq("state", state)
    .single();

  if (error || !data) return null;

  // Verifica expiração
  if (new Date(data.expires_at) < new Date()) {
    await supabase.from("oauth_states").delete().eq("state", state);
    return null;
  }

  // Consome o state (one-time use)
  await supabase.from("oauth_states").delete().eq("state", state);

  return { org_id: data.organization_id, user_id: data.user_id, shop: data.shop };
}

// ─── Salvar integração ──────────────────────────────────────────────────────

async function saveIntegration(
  supabase: any,
  orgId: string,
  marketplace: string,
  sellerId: string,
  sellerName: string,
  accessToken: string,
  refreshToken: string | null,
  expiresIn: number | null,
  config: Record<string, any> = {}
) {
  const { error } = await supabase.rpc("save_marketplace_integration", {
    p_org_id: orgId,
    p_marketplace: marketplace,
    p_seller_id: sellerId,
    p_seller_name: sellerName,
    p_access_token: accessToken,
    p_refresh_token: refreshToken,
    p_expires_in: expiresIn,
    p_config: config
  });

  if (error) throw new Error(`DB save failed: ${error.message}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// SHOPEE CALLBACK
// Shopee redireciona: ?code=xxx&shop_id=xxx  (state no redirect URI original)
// ═══════════════════════════════════════════════════════════════════════════

async function handleShopeeCallback(url: URL, supabase: any): Promise<Response> {
  const code    = url.searchParams.get("code");
  const shopId  = url.searchParams.get("shop_id");
  const state   = url.searchParams.get("state");

  if (!code || !shopId) {
    return redirect(`${APP_URL()}/?error=${enc("Shopee: código ou shop_id ausente")}`);
  }

  const stateData = await validateState(supabase, state);
  if (!stateData) {
    return redirect(`${APP_URL()}/?error=${enc("Shopee: state inválido ou expirado")}`);
  }

  // Token exchange
  const partnerId  = Deno.env.get("SHOPEE_PARTNER_ID")!;
  const partnerKey = Deno.env.get("SHOPEE_PARTNER_KEY")!;
  const timestamp  = Math.floor(Date.now() / 1000);
  const path       = "/api/v2/auth/token/get";
  const sign       = await hmacSha256(partnerKey, `${partnerId}${path}${timestamp}`);

  const sandbox = Deno.env.get("SHOPEE_SANDBOX") === "true";
  const host = sandbox ? "https://partner.test-stable.shopeemobile.com" : "https://partner.shopeemobile.com";

  const tokenRes = await fetch(`${host}${path}?partner_id=${partnerId}&timestamp=${timestamp}&sign=${sign}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, partner_id: Number(partnerId), shop_id: Number(shopId) }),
  });

  if (!tokenRes.ok) {
    const errText = await tokenRes.text();
    throw new Error(`Token exchange failed: ${errText}`);
  }

  const tokenData = await tokenRes.json();

  await saveIntegration(
    supabase, stateData.org_id, "shopee",
    String(shopId), `Shopee-${shopId}`,
    tokenData.access_token, tokenData.refresh_token,
    tokenData.expire_in,
    { shop_id: shopId }
  );

  return redirect(`${APP_URL()}/oauth/callback?connected=shopee&marketplace=shopee`);
}

// ═══════════════════════════════════════════════════════════════════════════
// AMAZON SP-API CALLBACK
// Amazon redireciona: ?spapi_oauth_code=xxx&state=xxx&selling_partner_id=xxx
// ═══════════════════════════════════════════════════════════════════════════

async function handleAmazonCallback(url: URL, supabase: any): Promise<Response> {
  const code      = url.searchParams.get("spapi_oauth_code");
  const state     = url.searchParams.get("state");
  const sellerId  = url.searchParams.get("selling_partner_id") ?? "";

  if (!code) {
    return redirect(`${APP_URL()}/?error=${enc("Amazon: código de autorização ausente")}`);
  }

  const stateData = await validateState(supabase, state);
  if (!stateData) {
    return redirect(`${APP_URL()}/?error=${enc("Amazon: state inválido ou expirado")}`);
  }

  // LWA Token Exchange
  const tokenRes = await fetch("https://api.amazon.com/auth/o2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type:    "authorization_code",
      code,
      redirect_uri:  Deno.env.get("AMAZON_REDIRECT_URI")!,
      client_id:     Deno.env.get("AMAZON_LWA_CLIENT_ID")!,
      client_secret: Deno.env.get("AMAZON_LWA_CLIENT_SECRET")!,
    }).toString(),
  });

  if (!tokenRes.ok) throw new Error(`LWA token exchange failed: ${await tokenRes.text()}`);
  const tokenData = await tokenRes.json();

  await saveIntegration(
    supabase, stateData.org_id, "amazon",
    sellerId, `Amazon BR - ${sellerId}`,
    tokenData.access_token, tokenData.refresh_token,
    tokenData.expires_in,
    { selling_partner_id: sellerId }
  );

  return redirect(`${APP_URL()}/oauth/callback?connected=amazon&marketplace=amazon`);
}

// ═══════════════════════════════════════════════════════════════════════════
// BLING ERP v3 CALLBACK
// Bling redireciona: ?code=xxx&state=xxx
// ═══════════════════════════════════════════════════════════════════════════

async function handleBlingCallback(url: URL, supabase: any): Promise<Response> {
  const code  = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (!code) {
    return redirect(`${APP_URL()}/?error=${enc("Bling: código de autorização ausente")}`);
  }

  const stateData = await validateState(supabase, state);
  if (!stateData) {
    return redirect(`${APP_URL()}/?error=${enc("Bling: state inválido ou expirado")}`);
  }

  // Basic Auth: base64(client_id:client_secret)
  const clientId     = Deno.env.get("BLING_CLIENT_ID")!;
  const clientSecret = Deno.env.get("BLING_CLIENT_SECRET")!;
  const credentials  = btoa(`${clientId}:${clientSecret}`);

  const tokenRes = await fetch("https://www.bling.com.br/Api/v3/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type":  "application/x-www-form-urlencoded",
      "Authorization": `Basic ${credentials}`,
    },
    body: new URLSearchParams({ grant_type: "authorization_code", code }).toString(),
  });

  if (!tokenRes.ok) throw new Error(`Bling token exchange failed: ${await tokenRes.text()}`);
  const tokenData = await tokenRes.json();

  await saveIntegration(
    supabase, stateData.org_id, "bling",
    "bling_erp", "Bling ERP",
    tokenData.access_token, tokenData.refresh_token,
    tokenData.expires_in,
    { scope: tokenData.scope }
  );

  return redirect(`${APP_URL()}/oauth/callback?connected=bling&marketplace=bling`);
}

// ═══════════════════════════════════════════════════════════════════════════
// SHOPIFY CALLBACK
// Shopify redireciona: ?code=xxx&hmac=xxx&shop=xxx&state=xxx&timestamp=xxx
// ⚠️ HMAC verification is MANDATORY before token exchange
// ═══════════════════════════════════════════════════════════════════════════

async function handleShopifyCallback(url: URL, supabase: any): Promise<Response> {
  const code      = url.searchParams.get("code");
  const hmac      = url.searchParams.get("hmac");
  const shop      = url.searchParams.get("shop");
  const state     = url.searchParams.get("state");
  const timestamp = url.searchParams.get("timestamp");

  if (!code || !hmac || !shop || !state) {
    return redirect(`${APP_URL()}/?error=${enc("Shopify: parâmetros de callback incompletos")}`);
  }

  // Step 1: HMAC Verification
  const secret = Deno.env.get("SHOPIFY_CLIENT_SECRET")!;
  const params = new URLSearchParams();
  for (const [key, val] of url.searchParams.entries()) {
    if (key !== "hmac" && key !== "marketplace") params.set(key, val);
  }
  params.sort();
  const message = params.toString();
  const computedHmac = await hmacSha256(secret, message);

  if (computedHmac !== hmac) {
    console.error(`[shopify] HMAC mismatch: expected ${hmac}, got ${computedHmac}`);
    return redirect(`${APP_URL()}/?error=${enc("Shopify: verificação HMAC falhou — possível adulteração")}`);
  }

  // Step 2: Validate state
  const stateData = await validateState(supabase, state);
  if (!stateData) {
    return redirect(`${APP_URL()}/?error=${enc("Shopify: state inválido ou expirado")}`);
  }

  // Step 3: Token exchange
  const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id:     Deno.env.get("SHOPIFY_CLIENT_ID")!,
      client_secret: secret,
      code,
    }),
  });

  if (!tokenRes.ok) throw new Error(`Shopify token exchange failed: ${await tokenRes.text()}`);
  const tokenData = await tokenRes.json();

  await saveIntegration(
    supabase, stateData.org_id, "shopify",
    shop, shop.replace(".myshopify.com", ""),
    tokenData.access_token, null, // Shopify tokens don't expire
    null,
    { shop, scope: tokenData.scope }
  );

  return redirect(`${APP_URL()}/oauth/callback?connected=shopify&marketplace=shopify`);
}

// ═══════════════════════════════════════════════════════════════════════════
// TIKTOK SHOP CALLBACK
// TikTok redireciona: ?code=xxx&state=xxx
// ═══════════════════════════════════════════════════════════════════════════

async function handleTikTokCallback(url: URL, supabase: any): Promise<Response> {
  const code  = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (!code) {
    return redirect(`${APP_URL()}/?error=${enc("TikTok: código de autorização ausente")}`);
  }

  const stateData = await validateState(supabase, state);
  if (!stateData) {
    return redirect(`${APP_URL()}/?error=${enc("TikTok: state inválido ou expirado")}`);
  }

  const appKey    = Deno.env.get("TIKTOK_APP_KEY")!;
  const appSecret = Deno.env.get("TIKTOK_APP_SECRET")!;

  const tokenRes = await fetch(
    `https://auth.tiktok-shops.com/api/v2/token/get?app_key=${appKey}&auth_code=${code}&app_secret=${appSecret}&grant_type=authorized_code`
  );

  if (!tokenRes.ok) throw new Error(`TikTok token exchange failed: ${await tokenRes.text()}`);
  const result   = await tokenRes.json();
  const tokData  = result.data ?? result;

  await saveIntegration(
    supabase, stateData.org_id, "tiktok_shop",
    tokData.seller_id ?? "tiktok", tokData.seller_name ?? "TikTok Shop",
    tokData.access_token, tokData.refresh_token,
    tokData.access_token_expire_in ?? 3600,
    {}
  );

  return redirect(`${APP_URL()}/oauth/callback?connected=tiktok_shop&marketplace=tiktok_shop`);
}

// ═══════════════════════════════════════════════════════════════════════════
// MERCADO LIVRE CALLBACK (mantém compatibilidade)
// ML redireciona: ?code=xxx&state=xxx
// ═══════════════════════════════════════════════════════════════════════════

async function handleMLCallback(url: URL, supabase: any): Promise<Response> {
  const code  = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (!code) return redirect(`${APP_URL()}/?error=${enc("ML: código ausente")}`);

  const stateData = await validateState(supabase, state);
  if (!stateData) {
    return redirect(`${APP_URL()}/?error=${enc("ML: state inválido ou expirado")}`);
  }

  const tokenRes = await fetch("https://api.mercadolibre.com/oauth/token", {
    method: "POST",
    headers: { "accept": "application/json", "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type:    "authorization_code",
      client_id:     Deno.env.get("ML_APP_ID")!,
      client_secret: Deno.env.get("ML_CLIENT_SECRET")!,
      code,
      redirect_uri:  Deno.env.get("ML_REDIRECT_URI")!,
    }).toString(),
  });

  if (!tokenRes.ok) throw new Error(`ML token failed: ${await tokenRes.text()}`);
  const tokenData = await tokenRes.json();

  // Busca info do vendedor
  const userRes = await fetch("https://api.mercadolibre.com/users/me", {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  const userInfo = userRes.ok ? await userRes.json() : {};

  await saveIntegration(
    supabase, stateData.org_id, "mercado_livre",
    String(tokenData.user_id), userInfo.nickname ?? `ML-${tokenData.user_id}`,
    tokenData.access_token, tokenData.refresh_token,
    tokenData.expires_in,
    { user_id: tokenData.user_id }
  );

  return redirect(`${APP_URL()}/oauth/callback?connected=mercado_livre&marketplace=mercado_livre`);
}

// ═══════════════════════════════════════════════════════════════════════════
// NUVEMSHOP CALLBACK
// Nuvemshop redireciona: ?code=xxx&state=xxx
// ═══════════════════════════════════════════════════════════════════════════

async function handleNuvemshopCallback(url: URL, supabase: any): Promise<Response> {
  const code  = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (!code) return redirect(`${APP_URL()}/?error=${enc("Nuvemshop: código ausente")}`);

  const stateData = await validateState(supabase, state);
  if (!stateData) {
    return redirect(`${APP_URL()}/?error=${enc("Nuvemshop: state inválido ou expirado")}`);
  }

  const tokenRes = await fetch("https://www.tiendanube.com/apps/authorize/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id:     Deno.env.get("NUVEMSHOP_APP_ID")!,
      client_secret: Deno.env.get("NUVEMSHOP_CLIENT_SECRET")!,
      grant_type:    "authorization_code",
      code,
    }),
  });

  if (!tokenRes.ok) throw new Error(`NS token failed: ${await tokenRes.text()}`);
  const tokenData = await tokenRes.json();

  await saveIntegration(
    supabase, stateData.org_id, "nuvemshop",
    String(tokenData.user_id), `Nuvemshop-${tokenData.user_id}`,
    tokenData.access_token, null, // Nuvemshop tokens don't expire
    null,
    { store_id: tokenData.user_id }
  );

  return redirect(`${APP_URL()}/oauth/callback?connected=nuvemshop&marketplace=nuvemshop`);
}

// ─── Utilitários ────────────────────────────────────────────────────────────

function redirect(url: string): Response {
  return new Response(null, { status: 302, headers: { Location: url } });
}

function enc(s: string): string {
  return encodeURIComponent(s);
}

async function hmacSha256(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, "0")).join("");
}
