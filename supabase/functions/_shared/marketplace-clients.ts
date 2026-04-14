// ============================================================================
// Shopee Open Platform API Client — Brazil
// Docs: https://open.shopee.com/documents
// Auth: OAuth2 com HMAC-SHA256 signature
// ============================================================================

import { createHmac } from "https://deno.land/std@0.177.0/node/crypto.ts";

const SHOPEE_AUTH_URL = "https://partner.shopeemobile.com/api/v2/shop/auth_partner";
const SHOPEE_TOKEN_URL = "https://partner.shopeemobile.com/api/v2/auth/token/get";
const SHOPEE_API_BASE  = "https://partner.shopeemobile.com/api/v2";

// Sandbox
const SHOPEE_SANDBOX_AUTH = "https://partner.test-stable.shopeemobile.com/api/v2/shop/auth_partner";
const SHOPEE_SANDBOX_API  = "https://partner.test-stable.shopeemobile.com/api/v2";

function getBase(): { auth: string; api: string } {
  const sandbox = Deno.env.get("SHOPEE_SANDBOX") === "true";
  return sandbox
    ? { auth: SHOPEE_SANDBOX_AUTH, api: SHOPEE_SANDBOX_API }
    : { auth: SHOPEE_AUTH_URL, api: SHOPEE_API_BASE };
}

function buildSignature(partnerId: string, secret: string, path: string, timestamp: number, shopId?: string): string {
  const base = shopId
    ? `${partnerId}${path}${timestamp}${shopId}`
    : `${partnerId}${path}${timestamp}`;
  return createHmac("sha256", secret).update(base).digest("hex");
}

export const Shopee = {
  getAuthUrl(redirectUri: string): string {
    const { auth } = getBase();
    const partnerId = Deno.env.get("SHOPEE_PARTNER_ID")!;
    const partnerKey = Deno.env.get("SHOPEE_PARTNER_KEY")!;
    const timestamp  = Math.floor(Date.now() / 1000);
    const path       = "/api/v2/shop/auth_partner";
    const sign       = buildSignature(partnerId, partnerKey, path, timestamp);
    return `${auth}?partner_id=${partnerId}&timestamp=${timestamp}&sign=${sign}&redirect=${encodeURIComponent(redirectUri)}`;
  },

  async exchangeCode(code: string, shopId: number | string): Promise<ShopeeTokenResponse> {
    const partnerId  = Deno.env.get("SHOPEE_PARTNER_ID")!;
    const partnerKey = Deno.env.get("SHOPEE_PARTNER_KEY")!;
    const timestamp  = Math.floor(Date.now() / 1000);
    const path       = "/api/v2/auth/token/get";
    const sign       = buildSignature(partnerId, partnerKey, path, timestamp);

    const url = `${SHOPEE_TOKEN_URL}?partner_id=${partnerId}&timestamp=${timestamp}&sign=${sign}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, partner_id: Number(partnerId), shop_id: Number(shopId) }),
    });
    if (!res.ok) throw new Error(`Shopee token exchange failed: ${await res.text()}`);
    return res.json();
  },

  async refreshToken(refreshToken: string, shopId: number | string): Promise<ShopeeTokenResponse> {
    const partnerId  = Deno.env.get("SHOPEE_PARTNER_ID")!;
    const partnerKey = Deno.env.get("SHOPEE_PARTNER_KEY")!;
    const timestamp  = Math.floor(Date.now() / 1000);
    const path       = "/api/v2/auth/access_token/get";
    const sign       = buildSignature(partnerId, partnerKey, path, timestamp);

    const url = `${getBase().api}${path}?partner_id=${partnerId}&timestamp=${timestamp}&sign=${sign}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken, partner_id: Number(partnerId), shop_id: Number(shopId) }),
    });
    if (!res.ok) throw new Error(`Shopee refresh failed: ${await res.text()}`);
    return res.json();
  },

  buildApiParams(path: string, accessToken: string, shopId: string | number): URLSearchParams {
    const partnerId  = Deno.env.get("SHOPEE_PARTNER_ID")!;
    const partnerKey = Deno.env.get("SHOPEE_PARTNER_KEY")!;
    const timestamp  = Math.floor(Date.now() / 1000);
    const sign       = buildSignature(partnerId, partnerKey, path, timestamp, String(shopId));
    return new URLSearchParams({
      partner_id: partnerId,
      shop_id: String(shopId),
      access_token: accessToken,
      timestamp: String(timestamp),
      sign,
    });
  },

  async getShopInfo(accessToken: string, shopId: string | number) {
    const path   = "/api/v2/shop/get_shop_info";
    const params = this.buildApiParams(path, accessToken, shopId);
    const res    = await fetch(`${getBase().api}${path}?${params}`);
    if (!res.ok) throw new Error(`Shopee getShopInfo failed: ${res.status}`);
    return res.json();
  },

  async getOrders(
    accessToken: string,
    shopId: string | number,
    opts: { cursor?: string; pageSize?: number; timeFrom?: number; timeTo?: number } = {}
  ) {
    const path   = "/api/v2/order/get_order_list";
    const params = this.buildApiParams(path, accessToken, shopId);
    params.set("order_status", "ALL");
    params.set("page_size", String(opts.pageSize ?? 50));
    if (opts.cursor) params.set("cursor", opts.cursor);
    const timeFrom = opts.timeFrom ?? Math.floor((Date.now() - 90 * 86400000) / 1000);
    const timeTo   = opts.timeTo   ?? Math.floor(Date.now() / 1000);
    params.set("time_range_field", "create_time");
    params.set("time_from", String(timeFrom));
    params.set("time_to", String(timeTo));
    const res = await fetch(`${getBase().api}${path}?${params}`);
    if (!res.ok) throw new Error(`Shopee getOrders failed: ${res.status}`);
    return res.json();
  },

  async getOrderDetails(accessToken: string, shopId: string | number, orderSns: string[]) {
    const path   = "/api/v2/order/get_order_detail";
    const params = this.buildApiParams(path, accessToken, shopId);
    params.set("order_sn_list", orderSns.join(","));
    params.set("response_optional_fields", "buyer_username,item_list,total_amount,payment_method,shipping_carrier");
    const res = await fetch(`${getBase().api}${path}?${params}`);
    if (!res.ok) throw new Error(`Shopee getOrderDetails failed: ${res.status}`);
    return res.json();
  },

  async getItems(accessToken: string, shopId: string | number, opts: { offset?: number; pageSize?: number } = {}) {
    const path   = "/api/v2/product/get_item_list";
    const params = this.buildApiParams(path, accessToken, shopId);
    params.set("item_status", "NORMAL");
    params.set("offset", String(opts.offset ?? 0));
    params.set("page_size", String(opts.pageSize ?? 100));
    const res = await fetch(`${getBase().api}${path}?${params}`);
    if (!res.ok) throw new Error(`Shopee getItems failed: ${res.status}`);
    return res.json();
  },
};

export interface ShopeeTokenResponse {
  access_token: string;
  refresh_token: string;
  expire_in: number;
  shop_id_list: number[];
  partner_id: number;
  error: string;
  message: string;
}

// ============================================================================
// Amazon Selling Partner API (SP-API) Client
// Docs: https://developer-docs.amazon.com/sp-api
// Auth: Login with Amazon (LWA) OAuth2
// ============================================================================

const AMAZON_LWA_TOKEN = "https://api.amazon.com/auth/o2/token";
const AMAZON_API_BASE  = "https://sellingpartnerapi-na.amazon.com"; // NA usado por BR

export const Amazon = {
  getLwaAuthUrl(state: string): string {
    const clientId    = Deno.env.get("AMAZON_LWA_CLIENT_ID")!;
    const redirectUri = Deno.env.get("AMAZON_REDIRECT_URI")!;
    const params = new URLSearchParams({
      application_id: Deno.env.get("AMAZON_APP_ID")!,
      state,
      version: "beta",
    });
    // Amazon usa SellerCentral para autorização
    return `https://sellercentral.amazon.com.br/apps/authorize/consent?${params.toString()}`;
  },

  async exchangeCode(code: string): Promise<AmazonTokenResponse> {
    const res = await fetch(AMAZON_LWA_TOKEN, {
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
    if (!res.ok) throw new Error(`Amazon LWA token exchange failed: ${await res.text()}`);
    return res.json();
  },

  async refreshToken(refreshToken: string): Promise<AmazonTokenResponse> {
    const res = await fetch(AMAZON_LWA_TOKEN, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type:    "refresh_token",
        refresh_token: refreshToken,
        client_id:     Deno.env.get("AMAZON_LWA_CLIENT_ID")!,
        client_secret: Deno.env.get("AMAZON_LWA_CLIENT_SECRET")!,
      }).toString(),
    });
    if (!res.ok) throw new Error(`Amazon LWA refresh failed: ${await res.text()}`);
    return res.json();
  },

  async getOrders(
    accessToken: string,
    marketplaceId = "A2Q3Y263D00KWC", // Brazil
    opts: { createdAfter?: string; nextToken?: string } = {}
  ) {
    const params = new URLSearchParams({ MarketplaceIds: marketplaceId });
    if (opts.createdAfter) params.set("CreatedAfter", opts.createdAfter);
    if (opts.nextToken)    params.set("NextToken", opts.nextToken);
    const res = await fetch(`${AMAZON_API_BASE}/orders/v0/orders?${params}`, {
      headers: {
        "x-amz-access-token": accessToken,
        "Content-Type": "application/json",
      },
    });
    if (!res.ok) throw new Error(`Amazon getOrders failed: ${res.status} ${await res.text()}`);
    return res.json();
  },

  async getOrderItems(accessToken: string, orderId: string) {
    const res = await fetch(`${AMAZON_API_BASE}/orders/v0/orders/${orderId}/orderItems`, {
      headers: { "x-amz-access-token": accessToken, "Content-Type": "application/json" },
    });
    if (!res.ok) throw new Error(`Amazon getOrderItems failed: ${res.status}`);
    return res.json();
  },

  async getInventory(accessToken: string, marketplaceId = "A2Q3Y263D00KWC") {
    const params = new URLSearchParams({ MarketplaceIds: marketplaceId, details: "true" });
    const res = await fetch(`${AMAZON_API_BASE}/fba/inventory/v1/summaries?granularityType=Marketplace&granularityId=${marketplaceId}&${params}`, {
      headers: { "x-amz-access-token": accessToken, "Content-Type": "application/json" },
    });
    if (!res.ok) throw new Error(`Amazon getInventory failed: ${res.status}`);
    return res.json();
  },
};

export interface AmazonTokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
}

// ============================================================================
// Bling ERP API Client v3
// Docs: https://developer.bling.com.br/
// Auth: OAuth2 — tokens expiram em 1h, refresh em 30d
// ============================================================================

const BLING_AUTH_URL  = "https://www.bling.com.br/OAuth2/Auth";
const BLING_TOKEN_URL = "https://www.bling.com.br/OAuth2/Api/Access";
const BLING_API_BASE  = "https://api.bling.com.br/Api/v3";

export const Bling = {
  getAuthUrl(state: string): string {
    const clientId    = Deno.env.get("BLING_CLIENT_ID")!;
    const redirectUri = Deno.env.get("BLING_REDIRECT_URI")!;
    const params = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      state,
    });
    return `${BLING_AUTH_URL}?${params.toString()}`;
  },

  async exchangeCode(code: string): Promise<BlingTokenResponse> {
    const clientId     = Deno.env.get("BLING_CLIENT_ID")!;
    const clientSecret = Deno.env.get("BLING_CLIENT_SECRET")!;
    const credentials  = btoa(`${clientId}:${clientSecret}`);
    const res = await fetch(BLING_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type":  "application/x-www-form-urlencoded",
        "Authorization": `Basic ${credentials}`,
      },
      body: new URLSearchParams({ grant_type: "authorization_code", code }).toString(),
    });
    if (!res.ok) throw new Error(`Bling token exchange failed: ${await res.text()}`);
    return res.json();
  },

  async refreshToken(refreshToken: string): Promise<BlingTokenResponse> {
    const clientId     = Deno.env.get("BLING_CLIENT_ID")!;
    const clientSecret = Deno.env.get("BLING_CLIENT_SECRET")!;
    const credentials  = btoa(`${clientId}:${clientSecret}`);
    const res = await fetch(BLING_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type":  "application/x-www-form-urlencoded",
        "Authorization": `Basic ${credentials}`,
      },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }).toString(),
    });
    if (!res.ok) throw new Error(`Bling refresh failed: ${await res.text()}`);
    return res.json();
  },

  async getOrders(accessToken: string, opts: { page?: number; limit?: number; situacaoId?: number } = {}) {
    const params = new URLSearchParams({
      pagina: String(opts.page ?? 1),
      limite: String(opts.limit ?? 100),
    });
    if (opts.situacaoId) params.set("idsSituacoes[0]", String(opts.situacaoId));
    const res = await fetch(`${BLING_API_BASE}/pedidos/vendas?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error(`Bling getOrders failed: ${res.status}`);
    return res.json();
  },

  async getProducts(accessToken: string, opts: { page?: number; limit?: number } = {}) {
    const params = new URLSearchParams({
      pagina: String(opts.page ?? 1),
      limite: String(opts.limit ?? 100),
    });
    const res = await fetch(`${BLING_API_BASE}/produtos?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error(`Bling getProducts failed: ${res.status}`);
    return res.json();
  },

  async getStock(accessToken: string, productId: string) {
    const res = await fetch(`${BLING_API_BASE}/estoques/${productId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error(`Bling getStock failed: ${res.status}`);
    return res.json();
  },

  async emitNFe(accessToken: string, orderId: string) {
    const res = await fetch(`${BLING_API_BASE}/nfe/${orderId}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    });
    if (!res.ok) throw new Error(`Bling emitNFe failed: ${res.status}`);
    return res.json();
  },
};

export interface BlingTokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
  refresh_token: string;
}

// ============================================================================
// Anymarket API Client
// Hub que conecta: Magalu, Americanas, Casas Bahia, Carrefour, OLX, Shoptime
// Docs: https://developers.anymarket.com.br/
// Auth: Token estático (API Key)
// ============================================================================

const ANYMARKET_API = "https://api.anymarket.com.br/v2";

export const Anymarket = {
  // Anymarket usa API Key estática (sem OAuth — configurada nos Supabase Secrets)
  getApiKey(): string {
    return Deno.env.get("ANYMARKET_API_KEY") ?? "";
  },

  async getOrders(opts: { offset?: number; limit?: number; since?: string } = {}) {
    const params = new URLSearchParams({
      offset: String(opts.offset ?? 0),
      limit:  String(opts.limit  ?? 50),
    });
    if (opts.since) params.set("dateCreatedAfter", opts.since);
    const res = await fetch(`${ANYMARKET_API}/orders?${params}`, {
      headers: {
        "gumgaToken":    this.getApiKey(),
        "Content-Type":  "application/json",
      },
    });
    if (!res.ok) throw new Error(`Anymarket getOrders failed: ${res.status}`);
    return res.json();
  },

  async getOrder(orderId: string) {
    const res = await fetch(`${ANYMARKET_API}/orders/${orderId}`, {
      headers: { "gumgaToken": this.getApiKey(), "Content-Type": "application/json" },
    });
    if (!res.ok) throw new Error(`Anymarket getOrder ${orderId} failed: ${res.status}`);
    return res.json();
  },

  async getProducts(opts: { offset?: number; limit?: number } = {}) {
    const params = new URLSearchParams({ offset: String(opts.offset ?? 0), limit: String(opts.limit ?? 50) });
    const res = await fetch(`${ANYMARKET_API}/products?${params}`, {
      headers: { "gumgaToken": this.getApiKey(), "Content-Type": "application/json" },
    });
    if (!res.ok) throw new Error(`Anymarket getProducts failed: ${res.status}`);
    return res.json();
  },

  async updateStock(productId: string, sku: string, quantity: number) {
    const res = await fetch(`${ANYMARKET_API}/stocks`, {
      method: "POST",
      headers: { "gumgaToken": this.getApiKey(), "Content-Type": "application/json" },
      body: JSON.stringify({ sku, quantity, wareHouses: [{ id: productId, quantity }] }),
    });
    if (!res.ok) throw new Error(`Anymarket updateStock failed: ${res.status}`);
    return res.json();
  },
};

// ============================================================================
// Shopify API Client
// Docs: https://shopify.dev/docs/api/admin-rest
// Auth: OAuth2 com permanent access token
// ============================================================================

export const Shopify = {
  getAuthUrl(shop: string, state: string): string {
    const clientId    = Deno.env.get("SHOPIFY_CLIENT_ID")!;
    const redirectUri = Deno.env.get("SHOPIFY_REDIRECT_URI")!;
    const scopes      = "read_orders,read_products,write_inventory,read_customers,read_fulfillments";
    const params = new URLSearchParams({
      client_id:    clientId,
      scope:        scopes,
      redirect_uri: redirectUri,
      state,
      "grant_options[]": "per-user",
    });
    return `https://${shop}/admin/oauth/authorize?${params.toString()}`;
  },

  async exchangeCode(shop: string, code: string): Promise<ShopifyTokenResponse> {
    const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id:     Deno.env.get("SHOPIFY_CLIENT_ID")!,
        client_secret: Deno.env.get("SHOPIFY_CLIENT_SECRET")!,
        code,
      }),
    });
    if (!res.ok) throw new Error(`Shopify token exchange failed: ${await res.text()}`);
    return res.json();
  },

  async getOrders(shop: string, accessToken: string, opts: { limit?: number; sinceId?: string; createdAtMin?: string } = {}) {
    const params = new URLSearchParams({ limit: String(opts.limit ?? 250), status: "any" });
    if (opts.sinceId)       params.set("since_id", opts.sinceId);
    if (opts.createdAtMin)  params.set("created_at_min", opts.createdAtMin);
    const res = await fetch(`https://${shop}/admin/api/2024-01/orders.json?${params}`, {
      headers: { "X-Shopify-Access-Token": accessToken, "Content-Type": "application/json" },
    });
    if (!res.ok) throw new Error(`Shopify getOrders failed: ${res.status}`);
    return res.json();
  },

  async getProducts(shop: string, accessToken: string, opts: { limit?: number; sinceId?: string } = {}) {
    const params = new URLSearchParams({ limit: String(opts.limit ?? 250) });
    if (opts.sinceId) params.set("since_id", opts.sinceId);
    const res = await fetch(`https://${shop}/admin/api/2024-01/products.json?${params}`, {
      headers: { "X-Shopify-Access-Token": accessToken, "Content-Type": "application/json" },
    });
    if (!res.ok) throw new Error(`Shopify getProducts failed: ${res.status}`);
    return res.json();
  },

  async registerWebhook(shop: string, accessToken: string, topic: string, callbackUrl: string) {
    const res = await fetch(`https://${shop}/admin/api/2024-01/webhooks.json`, {
      method: "POST",
      headers: { "X-Shopify-Access-Token": accessToken, "Content-Type": "application/json" },
      body: JSON.stringify({ webhook: { topic, address: callbackUrl, format: "json" } }),
    });
    if (!res.ok) throw new Error(`Shopify registerWebhook failed: ${res.status}`);
    return res.json();
  },
};

export interface ShopifyTokenResponse {
  access_token: string;
  scope: string;
  associated_user_scope: string;
  session: string;
}
