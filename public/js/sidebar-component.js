// sidebar-component.js — Sidebar unificada para todas as páginas
// Injeta sidebar consistente substituindo qualquer <aside class="sidebar"> existente

const SIDEBAR_HTML = `
<div class="sidebar-logo">
  <div class="sidebar-logo-icon">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
    </svg>
  </div>
  <span class="sidebar-logo-text">E-CONOMIA</span>
</div>
<nav class="sidebar-nav" aria-label="Navegação principal">
  <div class="nav-section">
    <p class="nav-label">Principal</p>
    <a href="dashboard.html" class="nav-link" data-page="dashboard">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/></svg>
      Dashboard
    </a>
    <a href="index.html" class="nav-link" data-page="index">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>
      Marketplaces
    </a>
  </div>
  <div class="nav-section">
    <p class="nav-label">Operações</p>
    <a href="pedidos.html" class="nav-link" data-page="pedidos">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/></svg>
      Pedidos
    </a>
    <a href="vendas.html" class="nav-link" data-page="vendas">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
      Vendas
    </a>
    <a href="estoque.html" class="nav-link" data-page="estoque">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
      Estoque
    </a>
    <a href="anuncios.html" class="nav-link" data-page="anuncios">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
      Anúncios
    </a>
    <a href="compras.html" class="nav-link" data-page="compras">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" x2="21" y1="6" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
      Compras
    </a>
    <a href="contabil.html" class="nav-link" data-page="contabil">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/></svg>
      Contábil
    </a>
    <a href="conciliacao.html" class="nav-link" data-page="conciliacao">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 3h5v5"/><path d="M8 3H3v5"/><path d="M12 22v-8.3a4 4 0 0 0-1.172-2.872L3 3"/><path d="m15 9 6-6"/></svg>
      Conciliação
    </a>
  </div>
  <div class="nav-section">
    <p class="nav-label">Conta</p>
    <a href="settings.html" class="nav-link" data-page="settings">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
      Configurações
    </a>
  </div>
</nav>
<div class="sidebar-footer">
  <div class="sidebar-user">
    <div class="sidebar-avatar" id="userInitials">?</div>
    <div class="sidebar-user-info">
      <p class="sidebar-user-name" id="userName">Carregando...</p>
      <p class="sidebar-user-role" id="userOrg">—</p>
    </div>
  </div>
</div>`;

export function initSidebar() {
  const aside = document.querySelector('aside.sidebar');
  if (!aside) return;

  aside.innerHTML = SIDEBAR_HTML;

  // Mark current page as active
  const currentPage = window.location.pathname.split('/').pop()?.replace('.html', '') || 'index';
  const activeLink = aside.querySelector(`[data-page="${currentPage}"]`);
  if (activeLink) activeLink.classList.add('active');
}
