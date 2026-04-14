// ============================================================================
// marketplace-authorize — GET endpoint que redireciona para OAuth do marketplace
// ============================================================================
// Fluxo: Browser GET → computa auth URL com secrets → HTTP 302 → OAuth page
//
// Query params:
//   marketplace  (obrigatório): shopee | amazon | bling | shopify | tiktok_shop
//   org_id       (obrigatório): UUID da organização
//   token        (obrigatório): JWT do Supabase (access_token do usuário)
//   shop         (shopify only): minhaloja.myshopify.com
// ============================================================================

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { handleCors } from "../_shared/cors.ts";
import { getServiceClient, getUserClient } from "../_shared/supabase.ts";

// ─── Marketplace auth URL builders (server-side, com secrets) ───────────────

function shopeeAuthUrl(redirectUri: string): string {
  const partnerId  = Deno.env.get("SHOPEE_PARTNER_ID")!;
  const partnerKey = Deno.env.get("SHOPEE_PARTNER_KEY")!;
  const timestamp  = Math.floor(Date.now() / 1000);
  const path       = "/api/v2/shop/auth_partner";
  const baseString = `${partnerId}${path}${timestamp}`;

  // HMAC-SHA256 via Web Crypto API (Deno native, sem dependência externa)
  const encoder = new TextEncoder();
  const keyData = encoder.encode(partnerKey);
  const msgData = encoder.encode(baseString);

  // Precisamos fazer sync — usamos crypto.subtle
  // Mas serve() é async, então podemos usar await no caller
  // Retornamos uma Promise
  return `__ASYNC__:${partnerId}:${timestamp}:${redirectUri}`;
}

async function computeShopeeUrl(redirectUri: string): Promise<string> {
  const partnerId  = Deno.env.get("SHOPEE_PARTNER_ID")!;
  const partnerKey = Deno.env.get("SHOPEE_PARTNER_KEY")!;
  const timestamp  = Math.floor(Date.now() / 1000);
  const path       = "/api/v2/shop/auth_partner";
  const baseString = `${partnerId}${path}${timestamp}`;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(partnerKey), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(baseString));
  const sign = [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, "0")).join("");

  const sandbox = Deno.env.get("SHOPEE_SANDBOX") === "true";
  const host = sandbox
    ? "https://partner.test-stable.shopeemobile.com"
    : "https://partner.shopeemobile.com";

  return `${host}/api/v2/shop/auth_partner?partner_id=${partnerId}&timestamp=${timestamp}&sign=${sign}&redirect=${encodeURIComponent(redirectUri)}`;
}

function amazonAuthUrl(state: string): string {
  const appId = Deno.env.get("AMAZON_APP_ID")!;
  // Amazon BR = sellercentral.amazon.com.br
  return `https://sellercentral.amazon.com.br/apps/authorize/consent?application_id=${encodeURIComponent(appId)}&state=${encodeURIComponent(state)}&version=beta`;
}

function blingAuthUrl(state: string): string {
  const clientId = Deno.env.get("BLING_CLIENT_ID")!;
  return `https://www.bling.com.br/Api/v3/oauth/authorize?response_type=code&client_id=${encodeURIComponent(clientId)}&state=${encodeURIComponent(state)}`;
}

function shopifyAuthUrl(shop: string, state: string): string {
  const clientId    = Deno.env.get("SHOPIFY_CLIENT_ID")!;
  const redirectUri = Deno.env.get("SHOPIFY_REDIRECT_URI")!;
  const scopes      = "read_orders,read_products,write_inventory,read_customers,read_fulfillments";
  return `https://${shop}/admin/oauth/authorize?client_id=${encodeURIComponent(clientId)}&scope=${encodeURIComponent(scopes)}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}`;
}

function tiktokAuthUrl(state: string): string {
  const appKey = Deno.env.get("TIKTOK_APP_KEY")!;
  return `https://services.tiktokshop.com/open/authorize?service_id=${encodeURIComponent(appKey)}&state=${encodeURIComponent(state)}`;
}

// ─── APP URL for callback ───────────────────────────────────────────────────

const SUPABASE_FN_BASE = `${Deno.env.get("SUPABASE_URL")!}/functions/v1`;

serve(async (req: Request) => {
  const corsRes = handleCors(req);
  if (corsRes) return corsRes;

  const url = new URL(req.url);
  const marketplace = url.searchParams.get("marketplace");
  const orgId       = url.searchParams.get("org_id");
  const token       = url.searchParams.get("token");
  const shop        = url.searchParams.get("shop");

  if (!marketplace || !orgId || !token) {
    return redirect302(`${appUrl()}/?error=${encodeURIComponent("Parâmetros inválidos")}`);
  }

  // ─── Valida JWT do usuário ──────────────────────────────────────────────
  const userClient = getUserClient(`Bearer ${token}`);
  const { data: { user }, error: authErr } = await userClient.auth.getUser();
  if (authErr || !user) {
    return redirect302(`${appUrl()}/?error=${encodeURIComponent("Sessão expirada. Faça login novamente.")}`);
  }

  // ─── Gera state token anti-CSRF e persiste ──────────────────────────────
  const statePayload = `${orgId}:${user.id}:${Date.now()}`;
  const stateBytes = new TextEncoder().encode(statePayload);
  const stateHash  = btoa(String.fromCharCode(...new Uint8Array(
    await crypto.subtle.digest("SHA-256", stateBytes)
  ))).replace(/[+/=]/g, (c) => ({ "+": "-", "/": "_", "=": "" }[c]!));
  const state = stateHash.slice(0, 32);

  const supabase = getServiceClient();
  await supabase.from("oauth_states").insert({
    state,
    organization_id: orgId,
    user_id: user.id,
    marketplace,
    shop: shop || null,
  });

  // Limpa estados expirados (fire & forget)
  supabase.from("oauth_states").delete().lt("expires_at", new Date().toISOString());

  // ─── Computa URL de autorização com secrets (NUNCA expostos) ────────────
  const callbackBase = `${SUPABASE_FN_BASE}/marketplace-callback`;
  let authUrl: string;

  try {
    switch (marketplace) {
      case "shopee": {
        const redirectUri = `${callbackBase}?marketplace=shopee&state=${state}`;
        authUrl = await computeShopeeUrl(redirectUri);
        break;
      }
      case "amazon":
        authUrl = amazonAuthUrl(state);
        break;
      case "bling":
        authUrl = blingAuthUrl(state);
        break;
      case "shopify": {
        if (!shop) {
          return redirect302(`${appUrl()}/?error=${encodeURIComponent("Domínio Shopify não informado")}`);
        }
        authUrl = shopifyAuthUrl(shop, state);
        break;
      }
      case "tiktok_shop":
        authUrl = tiktokAuthUrl(state);
        break;
      case "mercado_livre": {
        // ML usa o fluxo antigo — mantém compatibilidade
        const mlAppId      = Deno.env.get("ML_APP_ID")!;
        const mlRedirectUri = Deno.env.get("ML_REDIRECT_URI")!;
        authUrl = `https://auth.mercadolivre.com.br/authorization?response_type=code&client_id=${mlAppId}&redirect_uri=${encodeURIComponent(mlRedirectUri)}&state=${state}`;
        break;
      }
      case "nuvemshop": {
        const nsAppId = Deno.env.get("NUVEMSHOP_APP_ID")!;
        authUrl = `https://www.nuvemshop.com.br/apps/${nsAppId}/authorize?state=${state}`;
        break;
      }
      default:
        return redirect302(`${appUrl()}/?error=${encodeURIComponent("Marketplace não suportado: " + marketplace)}`);
    }
  } catch (err) {
    console.error(`[authorize] Error building auth URL for ${marketplace}:`, err);
    return redirect302(`${appUrl()}/?error=${encodeURIComponent("Erro ao gerar URL de autorização")}`);
  }

  console.log(`[authorize] Redirecting to ${marketplace} OAuth: ${authUrl.slice(0, 120)}...`);
  return redirect302(authUrl);
});

function appUrl(): string {
  return Deno.env.get("APP_URL") ?? "https://e-conomia.vercel.app";
}

function redirect302(url: string): Response {
  return new Response(null, {
    status: 302,
    headers: { Location: url },
  });
}
