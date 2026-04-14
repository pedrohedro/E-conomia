// ECOM-51 | marketplace-oauth Edge Function
// Router de OAuth para TODOS os marketplaces — Shopee, Amazon, Bling, Shopify, TikTok
// Rota: POST /marketplace-oauth  { action, marketplace, ...params }
//
// Secrets por marketplace (adicionar no Supabase Dashboard):
//   Shopee:   SHOPEE_PARTNER_ID, SHOPEE_PARTNER_KEY, SHOPEE_SANDBOX=true/false
//   Amazon:   AMAZON_APP_ID, AMAZON_LWA_CLIENT_ID, AMAZON_LWA_CLIENT_SECRET, AMAZON_REDIRECT_URI
//   Bling:    BLING_CLIENT_ID, BLING_CLIENT_SECRET, BLING_REDIRECT_URI
//   Shopify:  SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET, SHOPIFY_REDIRECT_URI
//   Anymarket:ANYMARKET_API_KEY
//   TikTok:   TIKTOK_APP_ID, TIKTOK_APP_SECRET

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { getCorsHeaders, handleCors } from "../_shared/cors.ts";
import { getServiceClient, getUserClient } from "../_shared/supabase.ts";
import { Shopee, Amazon, Bling, Anymarket, Shopify } from "../_shared/marketplace-clients.ts";

const REDIRECT_BASE = Deno.env.get("APP_URL") ?? "https://e-conomia.vercel.app";

serve(async (req: Request) => {
  const corsRes = handleCors(req);
  if (corsRes) return corsRes;
  const corsH = getCorsHeaders(req);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Unauthorized" }, 401, corsH);

  const userClient = getUserClient(authHeader);
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json({ error: "Sessão inválida" }, 401, corsH);

  let body: OAuthRequest;
  try { body = await req.json(); } catch { return json({ error: "JSON inválido" }, 400, corsH); }

  const { action, marketplace, organization_id } = body;
  if (!action || !marketplace) return json({ error: "action e marketplace são obrigatórios" }, 400, corsH);

  const supabase = getServiceClient();

  // ─── STEP 1: Gera URL de autorização ─────────────────────────────────────
  if (action === "get_auth_url") {
    const state = `${organization_id}:${user.id}:${Date.now()}`;
    let url = "";

    switch (marketplace) {
      case "shopee": {
        const redirectUri = `${REDIRECT_BASE}/oauth/callback?marketplace=shopee`;
        url = Shopee.getAuthUrl(redirectUri);
        break;
      }
      case "amazon":
        url = Amazon.getLwaAuthUrl(state);
        break;
      case "bling":
        url = Bling.getAuthUrl(state);
        break;
      case "shopify": {
        const shop = body.shop ?? "";
        if (!shop) return json({ error: "shop (ex: minhaloja.myshopify.com) é obrigatório" }, 400, corsH);
        url = Shopify.getAuthUrl(shop, state);
        break;
      }
      case "anymarket":
        return json({ type: "api_key", message: "Configure ANYMARKET_API_KEY nos Secrets do Supabase" }, 200, corsH);
      case "tiktok_shop": {
        const appId = Deno.env.get("TIKTOK_APP_ID") ?? "";
        url = `https://auth.tiktok-shops.com/oauth/authorize?app_key=${appId}&state=${state}&response_type=code`;
        break;
      }
      default:
        return json({ error: `Marketplace '${marketplace}' não suportado` }, 400, corsH);
    }

    return json({ auth_url: url, state }, 200, corsH);
  }

  // ─── STEP 2: Troca código por token ──────────────────────────────────────
  if (action === "exchange_code") {
    const { code, shop_id, shop } = body;
    if (!code) return json({ error: "code é obrigatório" }, 400, corsH);
    if (!organization_id) return json({ error: "organization_id é obrigatório" }, 400, corsH);

    try {
      let tokenData: Record<string, any> = {};
      let sellerInfo: Record<string, any> = {};
      let sellerId = "";
      let sellerName = "";

      switch (marketplace) {
        case "shopee": {
          if (!shop_id) return json({ error: "shop_id é obrigatório para Shopee" }, 400, corsH);
          tokenData = await Shopee.exchangeCode(code, Number(shop_id));
          const info = await Shopee.getShopInfo(tokenData.access_token, shop_id);
          sellerId   = String(shop_id);
          sellerName = info.response?.shop_name ?? `Shopee-${shop_id}`;
          sellerInfo = info;
          break;
        }
        case "amazon": {
          tokenData = await Amazon.exchangeCode(code);
          sellerId   = body.selling_partner_id ?? "BR_SELLER";
          sellerName = `Amazon BR - ${sellerId}`;
          break;
        }
        case "bling": {
          tokenData  = await Bling.exchangeCode(code);
          sellerId   = tokenData.user_store?.id ?? user.id;
          sellerName = tokenData.user_store?.nome ?? "Bling Store";
          break;
        }
        case "shopify": {
          if (!shop) return json({ error: "shop é obrigatório" }, 400, corsH);
          tokenData  = await Shopify.exchangeCode(shop, code);
          sellerId   = shop;
          sellerName = shop.replace(".myshopify.com", "");
          try {
            await Shopify.registerWebhook(shop, tokenData.access_token, "orders/create",
              `https://rqmpqxguecuhrsbzcwgb.supabase.co/functions/v1/shopify-webhook`);
          } catch { /* webhook pode ser configurado manualmente */ }
          break;
        }
        case "tiktok_shop": {
          const appKey    = Deno.env.get("TIKTOK_APP_ID") ?? "";
          const appSecret = Deno.env.get("TIKTOK_APP_SECRET") ?? "";
          const res = await fetch(`https://auth.tiktok-shops.com/api/v2/token/get?app_key=${appKey}&auth_code=${code}&app_secret=${appSecret}&grant_type=authorized_code`);
          tokenData  = await res.json();
          sellerId   = tokenData.data?.seller_id ?? "";
          sellerName = tokenData.data?.seller_name ?? "TikTok Shop";
          break;
        }
        default:
          return json({ error: `Marketplace '${marketplace}' não suportado` }, 400, corsH);
      }

      const expiresAt = tokenData.expires_in
        ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
        : null;

      const { error: dbErr } = await supabase
        .from("marketplace_integrations")
        .upsert({
          organization_id,
          marketplace,
          seller_id:     sellerId,
          seller_name:   sellerName,
          access_token:  tokenData.access_token,
          refresh_token: tokenData.refresh_token ?? null,
          token_expires_at: expiresAt,
          status: "active",
          config: { shop_id: shop_id ?? shop ?? null, seller_info: sellerInfo },
        }, { onConflict: "organization_id,marketplace" });

      if (dbErr) throw new Error(`DB error: ${dbErr.message}`);

      return json({
        success: true,
        marketplace,
        seller_id: sellerId,
        seller_name: sellerName,
        message: `${marketplace.replace(/_/g, " ")} conectado com sucesso!`,
      }, 200, corsH);

    } catch (err) {
      console.error(`OAuth exchange error [${marketplace}]:`, err);
      return json({ error: `Falha ao conectar ${marketplace}`, details: String(err) }, 500, corsH);
    }
  }

  // ─── STEP 3: Anymarket / Bling — salva API Key ───────────────────────────
  if (action === "save_api_key") {
    const { api_key } = body;
    if (!api_key || !organization_id) return json({ error: "api_key e organization_id são obrigatórios" }, 400, corsH);

    const displayName = marketplace === "bling" ? "Bling ERP" : "Anymarket Hub";

    const { error: dbErr } = await supabase
      .from("marketplace_integrations")
      .upsert({
        organization_id,
        marketplace,
        seller_id:    marketplace,
        seller_name:  displayName,
        access_token: api_key,
        status: "active",
        config: { type: "api_key" },
      }, { onConflict: "organization_id,marketplace" });

    if (dbErr) return json({ error: dbErr.message }, 500, corsH);
    return json({ success: true, message: `${displayName} conectado!` }, 200, corsH);
  }

  return json({ error: `Action '${action}' desconhecida` }, 400, corsH);
});

function json(d: unknown, s: number, h: Record<string, string>) {
  return new Response(JSON.stringify(d), { status: s, headers: { ...h, "Content-Type": "application/json" } });
}

interface OAuthRequest {
  action: "get_auth_url" | "exchange_code" | "save_api_key";
  marketplace: string;
  organization_id?: string;
  code?: string;
  shop_id?: string | number;
  shop?: string;
  selling_partner_id?: string;
  api_key?: string;
}
