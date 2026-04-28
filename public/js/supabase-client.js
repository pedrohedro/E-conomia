// =============================================================================
// E-CONOMIA: Supabase Client + Auth + Marketplace helpers
// Importar via <script type="module"> no HTML
// =============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Configuracao - sera substituida pelas variaveis reais do projeto Supabase
const SUPABASE_URL = window.__ENV__?.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = window.__ENV__?.SUPABASE_ANON_KEY || "";
const SUPABASE_FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`;

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
window.supabase = supabase; // Expose global for legacy scripts


// =============================================================================
// Auth helpers
// =============================================================================

export async function getCurrentUser() {
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

export async function getUserProfile() {
  const user = await getCurrentUser();
  if (!user) return null;

  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();
  return data;
}

export async function getUserOrganization() {
  const user = await getCurrentUser();
  if (!user) return null;

  const { data } = await supabase
    .from("org_members")
    .select("organization_id, role, organizations(*)")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .single();
  return data;
}

// Cria uma nova organização e adiciona o usuário autenticado como owner.
// Usa a RPC SECURITY DEFINER para resolver o problema de RLS chicken-and-egg
// (novo usuario nao pode fazer INSERT em org_members porque ainda nao e membro).
//
// @param {string} orgName  - Nome da organização (obrigatorio)
// @param {string} [orgSlug] - Slug para URLs (opcional; gerado automaticamente se omitido)
// @returns {Promise<{orgId: string}>} UUID da organização criada
export async function createOrganization(orgName, orgSlug = null) {
  const args = { org_name: orgName };
  if (orgSlug) args.org_slug = orgSlug;

  const { data, error } = await supabase.rpc("create_organization_with_member", args);
  if (error) throw error;
  return { orgId: data };
}

export async function signIn(email, password) {
  return supabase.auth.signInWithPassword({ email, password });
}

export async function signUp(email, password, fullName) {
  return supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName } },
  });
}

export async function signOut() {
  return supabase.auth.signOut();
}

// =============================================================================
// Marketplace Integration helpers
// =============================================================================

export function connectMarketplace(marketplace, orgId) {
  const url = `${SUPABASE_FUNCTIONS_URL}/marketplace-oauth/authorize?marketplace=${marketplace}&org_id=${orgId}`;
  window.location.href = url;
}

export async function getIntegrations(orgId) {
  const { data, error } = await supabase
    .from("marketplace_integrations")
    .select("id, marketplace, status, seller_id, seller_nickname, last_sync_at, last_sync_error, created_at")
    .eq("organization_id", orgId)
    .order("marketplace");
  if (error) throw error;
  return data ?? [];
}

export async function disconnectMarketplace(integrationId) {
  const { error } = await supabase
    .from("marketplace_integrations")
    .update({ status: "disconnected", access_token: null, refresh_token: null })
    .eq("id", integrationId);
  if (error) throw error;
}

export async function triggerSync(orgId, marketplace) {
  const session = await supabase.auth.getSession();
  const token = session.data.session?.access_token;

  const res = await fetch(`${SUPABASE_FUNCTIONS_URL}/sync-orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ organization_id: orgId, marketplace }),
  });
  return res.json();
}

// =============================================================================
// Check connection result from URL params (post-OAuth redirect)
// =============================================================================

export function checkOAuthResult() {
  const params = new URLSearchParams(window.location.search);
  const connected = params.get("connected");
  const error = params.get("error");

  if (connected || error) {
    // limpar params da URL sem recarregar
    window.history.replaceState({}, "", window.location.pathname);
  }

  return { connected, error };
}
