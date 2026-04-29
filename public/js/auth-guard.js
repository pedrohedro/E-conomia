import { supabase, getCurrentUser, getUserOrganization, signOut } from './supabase-client.js';

export async function requireAuth() {
  const user = await getCurrentUser();
  if (!user) {
    window.location.href = 'login.html';
    return null;
  }

  const orgData = await getUserOrganization();
  const org = orgData?.organizations ?? null;
  const orgId = orgData?.organization_id ?? null;
  const role = orgData?.role ?? null;

  // Usuário logado mas sem organização → onboarding
  if (!orgId && !window.location.pathname.includes('onboarding')) {
    window.location.href = 'onboarding.html';
    return null;
  }

  // Verifica se tem integrações. Se não tiver e não pulou onboarding, manda pro onboarding
  if (orgId && !window.location.pathname.includes('onboarding')) {
    const skipped = localStorage.getItem('onboarding_skipped');
    if (!skipped) {
      const { data: integrations } = await supabase
        .from('marketplace_integrations')
        .select('id')
        .eq('organization_id', orgId)
        .limit(1);
      
      if (!integrations || integrations.length === 0) {
        window.location.href = 'onboarding.html';
        return null;
      }
    }
  }

  window.__ECONOMIA__ = { user, org, orgId, role };

  updateProfileUI(user, orgData);

  // Retorna tudo que as páginas precisam
  return { user, org, orgId, role };
}

function updateProfileUI(user, orgData) {
  const profileData = user.user_metadata || {};
  const name = profileData.full_name || user.email?.split('@')[0] || 'Usuario';

  document.querySelectorAll('[data-user-name]').forEach(el => {
    el.textContent = name;
  });

  document.querySelectorAll('[data-user-role]').forEach(el => {
    const roles = { owner: 'Proprietario', admin: 'Administrador', manager: 'Gerente', viewer: 'Visualizador' };
    el.textContent = roles[orgData?.role] || 'Membro';
  });

  document.querySelectorAll('[data-user-avatar]').forEach(el => {
    el.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=0c0c0c&color=06B6D4&bold=true`;
  });

  document.querySelectorAll('[data-org-name]').forEach(el => {
    el.textContent = orgData?.organizations?.name || 'Minha Loja';
  });
}

export { supabase, signOut };
