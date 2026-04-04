import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { getServiceClient, getUserClient } from "../_shared/supabase.ts";
import { MercadoLivre, Nuvemshop } from "../_shared/marketplace-clients.ts";

serve(async (req: Request) => {
  const corsRes = handleCors(req);
  if (corsRes) return corsRes;

  const url = new URL(req.url);
  const path = url.pathname.split("/").pop();

  try {
    if (path === "authorize") return handleAuthorize(req, url);
    if (path === "callback") return handleCallback(req, url);
    return new Response("Not found", { status: 404 });
  } catch (err) {
    console.error("OAuth error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// =============================================================================
// GET /marketplace-oauth/authorize?marketplace=mercado_livre&org_id=xxx
// Redireciona o usuario para a tela de autorizacao do marketplace
// =============================================================================
async function handleAuthorize(_req: Request, url: URL): Promise<Response> {
  const marketplace = url.searchParams.get("marketplace");
  const orgId = url.searchParams.get("org_id");

  if (!marketplace || !orgId) {
    return new Response(
      JSON.stringify({ error: "marketplace and org_id are required" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // state codifica org_id + marketplace para recuperar no callback
  const statePayload = JSON.stringify({ org_id: orgId, marketplace });
  const state = btoa(statePayload);

  let authUrl: string;

  switch (marketplace) {
    case "mercado_livre":
      authUrl = MercadoLivre.getAuthUrl(state);
      break;
    case "nuvemshop":
      authUrl = Nuvemshop.getAuthUrl(state);
      break;
    default:
      return new Response(
        JSON.stringify({ error: `Marketplace "${marketplace}" not supported yet` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
  }

  return Response.redirect(authUrl, 302);
}

// =============================================================================
// GET /marketplace-oauth/callback?code=xxx&state=xxx
// Recebe o code do marketplace e troca por access_token
// =============================================================================
async function handleCallback(_req: Request, url: URL): Promise<Response> {
  const code = url.searchParams.get("code");
  const stateRaw = url.searchParams.get("state");

  if (!code || !stateRaw) {
    return errorRedirect("Parametros code/state ausentes");
  }

  let state: { org_id: string; marketplace: string };
  try {
    state = JSON.parse(atob(stateRaw));
  } catch {
    return errorRedirect("State invalido");
  }

  const supabase = getServiceClient();
  const { marketplace, org_id } = state;

  try {
    if (marketplace === "mercado_livre") {
      const tokens = await MercadoLivre.exchangeCode(code);
      const seller = await MercadoLivre.getSellerInfo(tokens.access_token);

      const expiresAt = new Date(
        Date.now() + tokens.expires_in * 1000
      ).toISOString();

      await supabase.from("marketplace_integrations").upsert(
        {
          organization_id: org_id,
          marketplace: "mercado_livre",
          status: "active",
          seller_id: String(tokens.user_id),
          seller_nickname: seller.nickname,
          seller_url: seller.permalink,
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          token_expires_at: expiresAt,
          oauth_scope: tokens.scope,
          config: {
            site_id: seller.site_id,
            seller_reputation: seller.seller_reputation?.level_id,
          },
          last_sync_at: null,
          last_sync_error: null,
        },
        { onConflict: "organization_id,marketplace" }
      );

      await supabase.from("sync_logs").insert({
        integration_id: await getIntegrationId(supabase, org_id, "mercado_livre"),
        organization_id: org_id,
        event_type: "oauth_connect",
        status: "success",
        metadata: { seller_id: tokens.user_id, nickname: seller.nickname },
      });
    } else if (marketplace === "nuvemshop") {
      const tokens = await Nuvemshop.exchangeCode(code);

      let storeName = "";
      try {
        const store = await Nuvemshop.getStoreInfo(
          tokens.access_token,
          tokens.user_id
        );
        storeName = store.name?.pt || store.name?.es || "";
      } catch {
        // store info is optional
      }

      await supabase.from("marketplace_integrations").upsert(
        {
          organization_id: org_id,
          marketplace: "nuvemshop",
          status: "active",
          seller_id: tokens.user_id,
          seller_nickname: storeName,
          access_token: tokens.access_token,
          refresh_token: null, // Nuvemshop tokens don't expire
          token_expires_at: null,
          oauth_scope: tokens.scope,
          config: { store_id: tokens.user_id },
          last_sync_at: null,
          last_sync_error: null,
        },
        { onConflict: "organization_id,marketplace" }
      );

      await supabase.from("sync_logs").insert({
        integration_id: await getIntegrationId(supabase, org_id, "nuvemshop"),
        organization_id: org_id,
        event_type: "oauth_connect",
        status: "success",
        metadata: { store_id: tokens.user_id, store_name: storeName },
      });
    }
  } catch (err) {
    console.error(`OAuth callback error for ${marketplace}:`, err);
    return errorRedirect(String(err));
  }

  const frontendUrl = Deno.env.get("FRONTEND_URL") || "http://localhost:3000";
  return Response.redirect(
    `${frontendUrl}/index.html?connected=${marketplace}`,
    302
  );
}

async function getIntegrationId(
  supabase: ReturnType<typeof getServiceClient>,
  orgId: string,
  marketplace: string
): Promise<string> {
  const { data } = await supabase
    .from("marketplace_integrations")
    .select("id")
    .eq("organization_id", orgId)
    .eq("marketplace", marketplace)
    .single();
  return data?.id;
}

function errorRedirect(message: string): Response {
  const frontendUrl = Deno.env.get("FRONTEND_URL") || "http://localhost:3000";
  return Response.redirect(
    `${frontendUrl}/index.html?error=${encodeURIComponent(message)}`,
    302
  );
}
