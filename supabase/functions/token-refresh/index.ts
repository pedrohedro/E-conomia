import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { getServiceClient } from "../_shared/supabase.ts";
import { MercadoLivre } from "../_shared/marketplace-clients.ts";

// Chamada via Supabase Cron a cada 30 minutos
// Renova tokens do Mercado Livre que expiram em menos de 1 hora
// Nuvemshop nao precisa de refresh (token permanente)
serve(async (req: Request) => {
  const corsRes = handleCors(req);
  if (corsRes) return corsRes;

  const supabase = getServiceClient();

  const oneHourFromNow = new Date(Date.now() + 60 * 60 * 1000).toISOString();

  // Buscar integrações que precisam de refresh usando RPC para decriptar os tokens
  const { data: activeExpiring } = await supabase.rpc("get_decrypted_integration_list", {
    p_status: "active",
    p_marketplace: "mercado_livre",
    p_expires_before: oneHourFromNow
  });

  const { data: expiredOnes } = await supabase.rpc("get_decrypted_integration_list", {
    p_status: "token_expired",
    p_marketplace: "mercado_livre",
    p_expires_before: null
  });

  const integrations = [...(activeExpiring ?? []), ...(expiredOnes ?? [])];
  const error = null;

  if (error) {
    console.error("Error fetching integrations:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const results: Array<{ id: string; status: string; error?: string }> = [];

  for (const integration of integrations ?? []) {
    try {
      const tokens = await MercadoLivre.refreshToken(
        integration.refresh_token!
      );

      // Usar a RPC de save_marketplace_integration para criptografar
      await supabase.rpc("save_marketplace_integration", {
        p_org_id: integration.organization_id,
        p_marketplace: integration.marketplace,
        p_seller_id: integration.seller_id,
        p_seller_name: integration.seller_name || integration.seller_id,
        p_access_token: tokens.access_token,
        p_refresh_token: tokens.refresh_token,
        p_expires_in: tokens.expires_in,
        p_config: integration.config || {}
      });

      await supabase.from("sync_logs").insert({
        integration_id: integration.id,
        organization_id: integration.organization_id,
        event_type: "token_refresh",
        status: "success",
        metadata: { new_expires_at: expiresAt },
      });

      results.push({ id: integration.id, status: "refreshed" });
    } catch (err) {
      console.error(
        `Token refresh failed for ${integration.id}:`,
        err
      );

      await supabase
        .from("marketplace_integrations")
        .update({
          status: "token_expired",
          last_sync_error: String(err),
        })
        .eq("id", integration.id);

      await supabase.from("sync_logs").insert({
        integration_id: integration.id,
        organization_id: integration.organization_id,
        event_type: "token_refresh",
        status: "error",
        error_message: String(err),
      });

      results.push({ id: integration.id, status: "error", error: String(err) });
    }
  }

  return new Response(
    JSON.stringify({
      processed: results.length,
      results,
    }),
    {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    }
  );
});
