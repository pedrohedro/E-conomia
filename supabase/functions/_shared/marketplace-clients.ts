// ============================================================================
// Mercado Livre API Client
// Docs: https://developers.mercadolivre.com.br/pt_br/autenticacao-e-autorizacao
// ============================================================================

const ML_AUTH_URL = "https://auth.mercadolivre.com.br/authorization";
const ML_TOKEN_URL = "https://api.mercadolibre.com/oauth/token";
const ML_API_BASE = "https://api.mercadolibre.com";

export const MercadoLivre = {
  getAuthUrl(state: string): string {
    const appId = Deno.env.get("ML_APP_ID")!;
    const redirectUri = Deno.env.get("ML_REDIRECT_URI")!;
    const params = new URLSearchParams({
      response_type: "code",
      client_id: appId,
      redirect_uri: redirectUri,
      state,
    });
    return `${ML_AUTH_URL}?${params.toString()}`;
  },

  async exchangeCode(code: string): Promise<MLTokenResponse> {
    const params = new URLSearchParams();
    params.append("grant_type", "authorization_code");
    params.append("client_id", Deno.env.get("ML_APP_ID") || "");
    params.append("client_secret", Deno.env.get("ML_CLIENT_SECRET") || "");
    params.append("code", code);
    params.append("redirect_uri", Deno.env.get("ML_REDIRECT_URI") || "");

    const res = await fetch(ML_TOKEN_URL, {
      method: "POST",
      headers: {
        "accept": "application/json",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(`ML token exchange failed: ${JSON.stringify(err)}`);
    }
    return res.json();
  },

  async refreshToken(refreshToken: string): Promise<MLTokenResponse> {
    const clientId = Deno.env.get("ML_APP_ID") || "";
    const clientSecret = Deno.env.get("ML_CLIENT_SECRET") || "";

    const bodyStr = `grant_type=refresh_token&client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(clientSecret)}&refresh_token=${encodeURIComponent(refreshToken)}`;

    console.log("[ML-DEBUG] refreshToken body:", bodyStr);

    const res = await fetch(ML_TOKEN_URL, {
      method: "POST",
      headers: {
        "accept": "application/json",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: bodyStr,
    });
    if (!res.ok) {
      const errText = await res.text();
      console.error("[ML-DEBUG] refresh error response:", errText);
      throw new Error(`ML token refresh failed: ${errText}`);
    }
    return res.json();
  },

  async getSellerInfo(accessToken: string) {
    const res = await fetch(`${ML_API_BASE}/users/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error(`ML /users/me failed: ${res.status}`);
    return res.json();
  },

  async getOrders(
    accessToken: string,
    sellerId: string,
    opts: { offset?: number; limit?: number; dateFrom?: string } = {}
  ) {
    const params = new URLSearchParams({
      seller: sellerId,
      sort: "date_desc",
      offset: String(opts.offset ?? 0),
      limit: String(opts.limit ?? 50),
    });
    if (opts.dateFrom) {
      params.set(
        "order.date_created.from",
        opts.dateFrom
      );
    }
    const res = await fetch(
      `${ML_API_BASE}/orders/search?${params.toString()}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!res.ok) throw new Error(`ML orders failed: ${res.status}`);
    return res.json();
  },

  async getOrder(accessToken: string, orderId: string) {
    const res = await fetch(`${ML_API_BASE}/orders/${orderId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error(`ML order ${orderId} failed: ${res.status}`);
    return res.json();
  },

  async getShipment(accessToken: string, shipmentId: string) {
    const res = await fetch(`${ML_API_BASE}/shipments/${shipmentId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    return res.json();
  },
};

export interface MLTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
  user_id: number;
  refresh_token: string;
}

// ============================================================================
// Nuvemshop API Client
// Docs: https://tiendanube.github.io/api-documentation/authentication
// Token NAO expira (invalido apenas ao gerar novo ou desinstalar app)
// ============================================================================

const NS_AUTH_URL_BR = "https://www.nuvemshop.com.br/apps";
const NS_TOKEN_URL = "https://www.tiendanube.com/apps/authorize/token";
const NS_API_BASE = "https://api.tiendanube.com/v1";

export const Nuvemshop = {
  getAuthUrl(state: string): string {
    const appId = Deno.env.get("NUVEMSHOP_APP_ID")!;
    return `${NS_AUTH_URL_BR}/${appId}/authorize?state=${encodeURIComponent(state)}`;
  },

  async exchangeCode(code: string): Promise<NSTokenResponse> {
    const res = await fetch(NS_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: Deno.env.get("NUVEMSHOP_APP_ID")!,
        client_secret: Deno.env.get("NUVEMSHOP_CLIENT_SECRET")!,
        grant_type: "authorization_code",
        code,
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`NS token exchange failed: ${err}`);
    }
    return res.json();
  },

  async getStoreInfo(accessToken: string, storeId: string) {
    const res = await fetch(`${NS_API_BASE}/${storeId}/store`, {
      headers: {
        Authentication: `bearer ${accessToken}`,
        "Content-Type": "application/json",
        "User-Agent": "E-conomia CRM (suporte@e-conomia.com.br)",
      },
    });
    if (!res.ok) throw new Error(`NS store info failed: ${res.status}`);
    return res.json();
  },

  async getOrders(
    accessToken: string,
    storeId: string,
    opts: { page?: number; perPage?: number; createdAtMin?: string } = {}
  ) {
    const params = new URLSearchParams({
      page: String(opts.page ?? 1),
      per_page: String(opts.perPage ?? 50),
    });
    if (opts.createdAtMin) {
      params.set("created_at_min", opts.createdAtMin);
    }
    const res = await fetch(
      `${NS_API_BASE}/${storeId}/orders?${params.toString()}`,
      {
        headers: {
          Authentication: `bearer ${accessToken}`,
          "Content-Type": "application/json",
          "User-Agent": "E-conomia CRM (suporte@e-conomia.com.br)",
        },
      }
    );
    if (!res.ok) throw new Error(`NS orders failed: ${res.status}`);
    return res.json();
  },

  async getOrder(accessToken: string, storeId: string, orderId: string) {
    const res = await fetch(
      `${NS_API_BASE}/${storeId}/orders/${orderId}`,
      {
        headers: {
          Authentication: `bearer ${accessToken}`,
          "Content-Type": "application/json",
          "User-Agent": "E-conomia CRM (suporte@e-conomia.com.br)",
        },
      }
    );
    if (!res.ok) throw new Error(`NS order ${orderId} failed: ${res.status}`);
    return res.json();
  },
};

export interface NSTokenResponse {
  access_token: string;
  token_type: string;
  scope: string;
  user_id: string;
}
