// ============================================================================
// marketplace-oauth — DEPRECADA
// ============================================================================
// Esta função foi substituída por:
//   - marketplace-authorize (GET → 302 redirect para OAuth page)
//   - marketplace-callback  (GET → recebe callback → troca code → 302 redirect)
//
// Mantida aqui apenas para compatibilidade com chamadas antigas.
// Redireciona para o novo fluxo.
// ============================================================================

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { getCorsHeaders, handleCors } from "../_shared/cors.ts";
import { getServiceClient, getUserClient } from "../_shared/supabase.ts";

const SUPABASE_FN_BASE = `${Deno.env.get("SUPABASE_URL")!}/functions/v1`;

serve(async (req: Request) => {
  const corsRes = handleCors(req);
  if (corsRes) return corsRes;
  const corsH = getCorsHeaders(req);

  // Se for um GET com authorize path, redireciona para o novo endpoint
  const url = new URL(req.url);
  if (url.pathname.includes("/authorize")) {
    const marketplace = url.searchParams.get("marketplace");
    const orgId       = url.searchParams.get("org_id");
    const returnUrl   = url.searchParams.get("return_url");
    // Redireciona para o novo authorize
    return new Response(null, {
      status: 302,
      headers: { Location: `${SUPABASE_FN_BASE}/marketplace-authorize?marketplace=${marketplace}&org_id=${orgId}` },
    });
  }

  // POST requests: retorna erro informando migração
  if (req.method === "POST") {
    try {
      const body = await req.json();

      // Suporte para save_api_key (Anymarket) que não tem OAuth redirect
      if (body.action === "save_api_key") {
        const authHeader = req.headers.get("Authorization");
        if (!authHeader) return json({ error: "Unauthorized" }, 401, corsH);

        const userClient = getUserClient(authHeader);
        const { data: { user } } = await userClient.auth.getUser();
        if (!user) return json({ error: "Sessão inválida" }, 401, corsH);

        const supabase = getServiceClient();
        const { error: dbErr } = await supabase
          .from("marketplace_integrations")
          .upsert({
            organization_id: body.organization_id,
            marketplace: body.marketplace,
            seller_id:    body.marketplace,
            seller_name:  body.marketplace === "bling" ? "Bling ERP" : "Anymarket Hub",
            seller_nickname: body.marketplace === "bling" ? "Bling ERP" : "Anymarket Hub",
            access_token: body.api_key,
            status: "active",
            config: { type: "api_key" },
          }, { onConflict: "organization_id,marketplace" });

        if (dbErr) return json({ error: dbErr.message }, 500, corsH);
        return json({ success: true, message: `${body.marketplace === "bling" ? "Bling ERP" : "Anymarket Hub"} conectado!` }, 200, corsH);
      }

      // Para qualquer outra ação, informa que o fluxo mudou
      return json({
        error: "Esta API foi descontinuada. Use marketplace-authorize (GET redirect) para OAuth.",
        migrate_to: `${SUPABASE_FN_BASE}/marketplace-authorize?marketplace=xxx&org_id=xxx&token=xxx`
      }, 410, corsH);

    } catch {
      return json({ error: "JSON inválido" }, 400, corsH);
    }
  }

  return json({ error: "Method not allowed" }, 405, corsH);
});

function json(d: unknown, s: number, h: Record<string, string>) {
  return new Response(JSON.stringify(d), { status: s, headers: { ...h, "Content-Type": "application/json" } });
}
