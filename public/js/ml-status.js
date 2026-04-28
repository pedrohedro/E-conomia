/**
 * ml-status.js — ECOM-95
 * Circuit breaker + banner de status de conexão com o ML.
 * Importar em qualquer página que faz chamadas à API do ML.
 */

const ML_STATUS_KEY    = 'ml_connection_status';
const ML_LAST_OK_KEY   = 'ml_last_ok_at';
const BANNER_ID        = 'ml-status-banner';
const MAX_FAILURES     = 3;
const HALF_OPEN_DELAY  = 60_000; // 1 min para tentar reabrir o circuito

let failureCount  = 0;
let circuitState  = 'closed'; // closed | open | half_open
let lastFailAt    = 0;

// ---------------------------------------------------------------------------
// Circuit Breaker
// ---------------------------------------------------------------------------

export function recordMLSuccess() {
  failureCount = 0;
  circuitState = 'closed';
  sessionStorage.setItem(ML_STATUS_KEY, 'ok');
  sessionStorage.setItem(ML_LAST_OK_KEY, new Date().toISOString());
  hideBanner();
}

export function recordMLFailure(reason = '') {
  failureCount++;
  lastFailAt = Date.now();
  if (failureCount >= MAX_FAILURES) {
    circuitState = 'open';
    sessionStorage.setItem(ML_STATUS_KEY, 'degraded');
    showBanner(reason);
  }
}

export function isMLCircuitOpen() {
  if (circuitState === 'closed') return false;
  if (circuitState === 'open') {
    if (Date.now() - lastFailAt > HALF_OPEN_DELAY) {
      circuitState = 'half_open';
      return false; // Permite uma tentativa
    }
    return true;
  }
  return false; // half_open: permite
}

// ---------------------------------------------------------------------------
// Banner de degradação
// ---------------------------------------------------------------------------

function getBanner() {
  let el = document.getElementById(BANNER_ID);
  if (!el) {
    el = document.createElement('div');
    el.id = BANNER_ID;
    el.style.cssText = `
      display:none; align-items:center; justify-content:space-between;
      gap:10px; padding:9px 16px;
      background:color-mix(in srgb,var(--warning,#f59e0b) 12%,transparent);
      border-bottom:1px solid color-mix(in srgb,var(--warning,#f59e0b) 30%,transparent);
      font-size:12.5px; font-weight:500;
      color:color-mix(in srgb,var(--warning,#f59e0b) 80%,var(--foreground,#0f172a));
      z-index:90; position:sticky; top:0;
    `;
    el.innerHTML = `
      <span id="${BANNER_ID}-msg" style="display:flex;align-items:center;gap:7px;">
        <svg style="width:14px;height:14px;flex-shrink:0;" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" stroke-width="2">
          <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/>
          <path d="M12 9v4"/><path d="M12 17h.01"/>
        </svg>
        <span>Mercado Livre fora do ar — exibindo dados em cache</span>
      </span>
      <div style="display:flex;align-items:center;gap:10px;">
        <span id="${BANNER_ID}-ts" style="font-size:11.5px;opacity:.75;"></span>
        <button onclick="window.__mlStatus?.retry()"
          style="font-size:12px;font-weight:600;padding:3px 10px;border-radius:6px;
                 border:1px solid currentColor;background:transparent;cursor:pointer;
                 color:inherit;">
          Tentar novamente
        </button>
        <button onclick="document.getElementById('${BANNER_ID}').style.display='none'"
          style="background:transparent;border:none;cursor:pointer;font-size:16px;
                 line-height:1;color:inherit;opacity:.6;">×</button>
      </div>
    `;
    // Insere antes do main content (ou no body)
    const mainContent = document.querySelector('.main-content') ?? document.body;
    mainContent.prepend(el);
  }
  return el;
}

export function showBanner(reason = '') {
  const el = getBanner();
  const msg = document.getElementById(`${BANNER_ID}-msg`);
  const ts  = document.getElementById(`${BANNER_ID}-ts`);
  if (msg) {
    const lastOk = sessionStorage.getItem(ML_LAST_OK_KEY);
    const desc = reason || 'Mercado Livre indisponível';
    msg.querySelector('span:last-child').textContent =
      `${desc} — exibindo dados em cache`;
    if (lastOk && ts) {
      const mins = Math.round((Date.now() - new Date(lastOk).getTime()) / 60_000);
      ts.textContent = `Última atualização: ${mins < 1 ? 'agora mesmo' : `há ${mins} min`}`;
    }
  }
  el.style.display = 'flex';
}

export function hideBanner() {
  const el = document.getElementById(BANNER_ID);
  if (el) el.style.display = 'none';
}

// ---------------------------------------------------------------------------
// Wrapper para fetch com circuit breaker automático
// ---------------------------------------------------------------------------

export async function mlFetch(url, options = {}) {
  if (isMLCircuitOpen()) {
    showBanner('ML API pausada (circuit breaker ativo)');
    throw new Error('ML circuit open — usando cache');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timeout);

    if (res.status === 429) {
      recordMLFailure('Rate limit atingido');
      throw new Error('ML rate limit');
    }
    if (res.status >= 500) {
      recordMLFailure(`ML API erro ${res.status}`);
      throw new Error(`ML HTTP ${res.status}`);
    }

    const data = await res.json();
    recordMLSuccess();
    return data;

  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      recordMLFailure('Timeout ao conectar com ML (>10s)');
    } else if (!err.message?.includes('circuit open')) {
      recordMLFailure(err.message);
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Retry manual (botão no banner)
// ---------------------------------------------------------------------------

window.__mlStatus = {
  retry() {
    circuitState = 'half_open';
    failureCount = 0;
    hideBanner();
    // Dispara evento para que as páginas recarreguem
    window.dispatchEvent(new CustomEvent('ml-status-retry'));
  },
};

// ---------------------------------------------------------------------------
// Health check periódico (a cada 2 min quando circuito aberto)
// ---------------------------------------------------------------------------

setInterval(() => {
  if (circuitState === 'open' && Date.now() - lastFailAt > HALF_OPEN_DELAY) {
    circuitState = 'half_open';
    window.dispatchEvent(new CustomEvent('ml-status-retry'));
  }
}, 30_000);

// ---------------------------------------------------------------------------
// Inicializa banner se já estava degradado no sessionStorage
// ---------------------------------------------------------------------------
if (sessionStorage.getItem(ML_STATUS_KEY) === 'degraded') {
  showBanner();
}
