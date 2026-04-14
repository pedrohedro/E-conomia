/**
 * E-conomia AI Chat Widget
 * ECOM-39 | Assistente AI flutuante com contexto de dados reais
 *
 * Como usar: <script type="module" src="/js/ai-chat-widget.js"></script>
 * Requer: window.__ECONOMIA__.orgId e supabase client disponíveis
 */

import { supabase } from './supabase-client.js';

const SUPABASE_FUNCTIONS = 'https://rqmpqxguecuhrsbzcwgb.supabase.co/functions/v1';

// ─── Markdown simples para HTML ─────────────────────────────────────────────
function mdToHtml(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code style="background:rgba(255,255,255,.08);padding:1px 4px;border-radius:3px;font-size:12px;">$1</code>')
    .replace(/^#{1,3} (.+)$/gm, '<p style="font-weight:700;margin:8px 0 2px;">$1</p>')
    .replace(/^- (.+)$/gm, '<li style="margin:2px 0;">$1</li>')
    .replace(/(<li[\s\S]*?<\/li>)+/g, m => `<ul style="margin:4px 0;padding-left:16px;">${m}</ul>`)
    .replace(/\n{2,}/g, '</p><p style="margin:6px 0;">')
    .replace(/\n/g, '<br>');
}

// ─── CSS injetado uma única vez ─────────────────────────────────────────────
function injectStyles() {
  if (document.getElementById('ai-chat-styles')) return;
  const style = document.createElement('style');
  style.id = 'ai-chat-styles';
  style.textContent = `
    #ai-fab {
      position: fixed; bottom: 24px; right: 24px; z-index: 9999;
      width: 52px; height: 52px; border-radius: 50%;
      background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
      border: none; cursor: pointer; box-shadow: 0 4px 24px rgba(99,102,241,.5);
      display: flex; align-items: center; justify-content: center;
      transition: transform .2s, box-shadow .2s;
      color: #fff;
    }
    #ai-fab:hover { transform: scale(1.08); box-shadow: 0 6px 32px rgba(99,102,241,.65); }
    #ai-fab .ai-fab-badge {
      position: absolute; top: -3px; right: -3px;
      width: 14px; height: 14px; border-radius: 50%;
      background: #10b981; border: 2px solid var(--background, #0f1117);
      animation: ai-pulse 2s infinite;
    }
    @keyframes ai-pulse { 0%,100% { opacity:1; } 50% { opacity:.5; } }

    #ai-panel {
      position: fixed; bottom: 88px; right: 24px; z-index: 9998;
      width: 380px; max-height: 560px;
      background: var(--card, #1a1d2e);
      border: 1px solid var(--border, rgba(255,255,255,.08));
      border-radius: 16px;
      box-shadow: 0 24px 80px rgba(0,0,0,.5);
      display: flex; flex-direction: column;
      transform: translateY(16px) scale(.97);
      opacity: 0; pointer-events: none;
      transition: transform .25s cubic-bezier(.34,1.56,.64,1), opacity .2s;
    }
    #ai-panel.open {
      opacity: 1; pointer-events: all;
      transform: translateY(0) scale(1);
    }
    #ai-panel-header {
      padding: 14px 16px 12px;
      border-bottom: 1px solid var(--border, rgba(255,255,255,.06));
      display: flex; align-items: center; gap: 10px;
    }
    .ai-header-dot {
      width: 32px; height: 32px; border-radius: 50%; flex-shrink: 0;
      background: linear-gradient(135deg, #6366f1, #8b5cf6);
      display: flex; align-items: center; justify-content: center;
    }
    .ai-header-info { flex: 1; }
    .ai-header-name { font-size: 13px; font-weight: 700; color: var(--foreground,#fff); }
    .ai-header-status { font-size: 11px; color: #10b981; display: flex; align-items: center; gap: 4px; }
    .ai-status-dot { width: 6px; height: 6px; border-radius: 50%; background: #10b981; animation: ai-pulse 2s infinite; }
    #ai-clear-btn {
      background: transparent; border: none; cursor: pointer;
      color: var(--muted-foreground, #666); padding: 4px;
      border-radius: 4px; line-height: 0;
      transition: color .15s;
    }
    #ai-clear-btn:hover { color: var(--foreground,#fff); }

    #ai-messages {
      flex: 1; overflow-y: auto; padding: 14px;
      display: flex; flex-direction: column; gap: 10px;
      scroll-behavior: smooth;
    }
    #ai-messages::-webkit-scrollbar { width: 4px; }
    #ai-messages::-webkit-scrollbar-track { background: transparent; }
    #ai-messages::-webkit-scrollbar-thumb { background: rgba(255,255,255,.1); border-radius: 2px; }

    .ai-msg {
      max-width: 88%; line-height: 1.5;
      font-size: 13px; padding: 9px 12px; border-radius: 12px;
      animation: ai-msgIn .2s ease;
    }
    @keyframes ai-msgIn { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:translateY(0); } }
    .ai-msg.user {
      align-self: flex-end;
      background: linear-gradient(135deg, #6366f1, #8b5cf6);
      color: #fff; border-bottom-right-radius: 3px;
    }
    .ai-msg.assistant {
      align-self: flex-start;
      background: var(--secondary, rgba(255,255,255,.05));
      color: var(--foreground, #fff); border-bottom-left-radius: 3px;
      border: 1px solid var(--border, rgba(255,255,255,.06));
    }
    .ai-msg.typing {
      align-self: flex-start;
      background: var(--secondary, rgba(255,255,255,.05));
      border: 1px solid var(--border, rgba(255,255,255,.06));
    }
    .ai-typing-dots { display: flex; gap: 4px; align-items: center; padding: 2px 0; }
    .ai-typing-dots span {
      width: 6px; height: 6px; border-radius: 50%;
      background: var(--muted-foreground, #666);
      animation: ai-dot .9s infinite;
    }
    .ai-typing-dots span:nth-child(2) { animation-delay: .15s; }
    .ai-typing-dots span:nth-child(3) { animation-delay: .3s; }
    @keyframes ai-dot { 0%,80%,100%{transform:scale(.8);opacity:.4} 40%{transform:scale(1);opacity:1} }

    .ai-suggestion-row {
      display: flex; flex-wrap: wrap; gap: 6px;
      padding: 0 14px 10px;
    }
    .ai-suggestion {
      font-size: 11.5px; padding: 5px 10px; border-radius: 20px;
      background: transparent;
      border: 1px solid var(--border, rgba(255,255,255,.1));
      color: var(--muted-foreground, #999);
      cursor: pointer; transition: border-color .15s, color .15s;
      white-space: nowrap;
    }
    .ai-suggestion:hover { border-color: #6366f1; color: #a5b4fc; }

    #ai-input-row {
      padding: 10px 12px;
      border-top: 1px solid var(--border, rgba(255,255,255,.06));
      display: flex; gap: 8px; align-items: flex-end;
    }
    #ai-input {
      flex: 1; background: var(--secondary, rgba(255,255,255,.05));
      border: 1px solid var(--border, rgba(255,255,255,.08));
      border-radius: 10px; padding: 8px 12px;
      font-size: 13px; color: var(--foreground,#fff);
      resize: none; outline: none; line-height: 1.4;
      font-family: inherit; max-height: 96px; min-height: 36px;
      transition: border-color .15s;
    }
    #ai-input::placeholder { color: var(--muted-foreground,#666); }
    #ai-input:focus { border-color: #6366f1; }
    #ai-send {
      width: 36px; height: 36px; border-radius: 10px; border: none;
      background: linear-gradient(135deg, #6366f1, #8b5cf6);
      color: #fff; cursor: pointer; display: flex; align-items: center; justify-content: center;
      flex-shrink: 0; transition: opacity .15s;
    }
    #ai-send:disabled { opacity: .4; cursor: default; }
    #ai-send:not(:disabled):hover { opacity: .85; }

    .ai-empty-state {
      flex: 1; display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      gap: 8px; padding: 24px; text-align: center;
    }
    .ai-empty-icon {
      width: 48px; height: 48px; border-radius: 50%;
      background: linear-gradient(135deg, rgba(99,102,241,.2), rgba(139,92,246,.2));
      display: flex; align-items: center; justify-content: center;
      margin-bottom: 4px;
    }
    .ai-empty-title { font-size: 14px; font-weight: 600; color: var(--foreground,#fff); }
    .ai-empty-sub { font-size: 12px; color: var(--muted-foreground,#666); line-height: 1.4; }
  `;
  document.head.appendChild(style);
}

// ─── HTML do widget ─────────────────────────────────────────────────────────
function buildWidget() {
  const fab = document.createElement('button');
  fab.id = 'ai-fab';
  fab.title = 'E-conomia AI';
  fab.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:22px;height:22px;">
      <path d="M12 2a8 8 0 0 1 8 8c0 4.4-4 8-8 10-4-2-8-5.6-8-10a8 8 0 0 1 8-8z"/>
      <path d="M8 12h.01M12 12h.01M16 12h.01"/>
    </svg>
    <span class="ai-fab-badge"></span>
  `;

  const panel = document.createElement('div');
  panel.id = 'ai-panel';
  panel.innerHTML = `
    <div id="ai-panel-header">
      <div class="ai-header-dot">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;color:#fff;">
          <path d="M12 2a8 8 0 0 1 8 8c0 4.4-4 8-8 10-4-2-8-5.6-8-10a8 8 0 0 1 8-8z"/>
          <path d="M8 12h.01M12 12h.01M16 12h.01"/>
        </svg>
      </div>
      <div class="ai-header-info">
        <p class="ai-header-name">E-conomia AI</p>
        <p class="ai-header-status">
          <span class="ai-status-dot"></span>
          Online · Dados em tempo real
        </p>
      </div>
      <button id="ai-clear-btn" title="Limpar conversa">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:15px;height:15px;">
          <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/>
        </svg>
      </button>
    </div>
    <div id="ai-messages">
      <div class="ai-empty-state" id="ai-empty">
        <div class="ai-empty-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="#a5b4fc" stroke-width="1.5" style="width:24px;height:24px;">
            <path d="M12 2a8 8 0 0 1 8 8c0 4.4-4 8-8 10-4-2-8-5.6-8-10a8 8 0 0 1 8-8z"/>
            <path d="M8 12h.01M12 12h.01M16 12h.01"/>
          </svg>
        </div>
        <p class="ai-empty-title">Olá! Sou o E-conomia AI</p>
        <p class="ai-empty-sub">Pergunte sobre vendas, estoque, taxas ou qualquer dado do seu negócio.</p>
      </div>
    </div>
    <div class="ai-suggestion-row">
      <button class="ai-suggestion" data-q="Como foram minhas vendas hoje?">Vendas hoje</button>
      <button class="ai-suggestion" data-q="Quais produtos mais venderam este mês?">Top produtos</button>
      <button class="ai-suggestion" data-q="Tenho produtos com estoque crítico?">Estoque crítico</button>
      <button class="ai-suggestion" data-q="Qual minha receita líquida nos últimos 7 dias?">Receita líquida</button>
    </div>
    <div id="ai-input-row">
      <textarea id="ai-input" placeholder="Pergunte sobre suas vendas..." rows="1"></textarea>
      <button id="ai-send" disabled>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;">
          <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
        </svg>
      </button>
    </div>
  `;

  document.body.appendChild(fab);
  document.body.appendChild(panel);
  return { fab, panel };
}

// ─── Inicialização ───────────────────────────────────────────────────────────
export function initAIChat() {
  injectStyles();
  const { fab, panel } = buildWidget();

  const messagesEl = panel.querySelector('#ai-messages');
  const inputEl = panel.querySelector('#ai-input');
  const sendEl = panel.querySelector('#ai-send');
  const clearEl = panel.querySelector('#ai-clear-btn');
  const emptyEl = panel.querySelector('#ai-empty');

  let isOpen = false;
  let isLoading = false;

  // Toggle panel
  fab.addEventListener('click', () => {
    isOpen = !isOpen;
    panel.classList.toggle('open', isOpen);
    if (isOpen) inputEl.focus();
  });

  // Close on outside click
  document.addEventListener('click', (e) => {
    if (isOpen && !panel.contains(e.target) && e.target !== fab) {
      isOpen = false;
      panel.classList.remove('open');
    }
  });

  // Input auto-resize
  inputEl.addEventListener('input', () => {
    sendEl.disabled = !inputEl.value.trim() || isLoading;
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 96) + 'px';
  });

  // Enter to send (Shift+Enter = new line)
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!sendEl.disabled) sendMessage();
    }
  });

  sendEl.addEventListener('click', sendMessage);

  // Suggestions
  panel.querySelectorAll('.ai-suggestion').forEach(btn => {
    btn.addEventListener('click', () => {
      inputEl.value = btn.dataset.q;
      sendEl.disabled = false;
      sendMessage();
    });
  });

  // Clear history
  clearEl.addEventListener('click', async () => {
    messagesEl.innerHTML = '';
    messagesEl.appendChild(emptyEl);
    emptyEl.style.display = 'flex';
    // Limpa do banco
    const orgId = window.__ECONOMIA__?.orgId;
    const { data: { user } } = await supabase.auth.getUser();
    if (orgId && user) {
      await supabase.from('ai_chat_history')
        .delete()
        .eq('organization_id', orgId)
        .eq('user_id', user.id);
    }
  });

  async function sendMessage() {
    const question = inputEl.value.trim();
    if (!question || isLoading) return;

    const orgId = window.__ECONOMIA__?.orgId;
    if (!orgId) {
      appendMessage('assistant', '⚠️ Você precisa estar conectado a uma organização para usar o AI.');
      return;
    }

    // Esconde empty state
    if (emptyEl.parentNode) emptyEl.style.display = 'none';

    // Adiciona mensagem do usuário
    appendMessage('user', question);
    inputEl.value = '';
    inputEl.style.height = 'auto';
    sendEl.disabled = true;
    isLoading = true;

    // Typing indicator
    const typingEl = document.createElement('div');
    typingEl.className = 'ai-msg typing';
    typingEl.innerHTML = `<div class="ai-typing-dots"><span></span><span></span><span></span></div>`;
    messagesEl.appendChild(typingEl);
    scrollToBottom();

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      const res = await fetch(`${SUPABASE_FUNCTIONS}/ai-chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: 'Bearer ' + token } : {}),
        },
        body: JSON.stringify({ question, organization_id: orgId }),
      });

      const data = await res.json();
      typingEl.remove();

      if (!res.ok || data.error) {
        appendMessage('assistant', '❌ ' + (data.error ?? 'Erro desconhecido. Tente novamente.'));
      } else {
        appendMessage('assistant', data.answer, true);
      }
    } catch (err) {
      typingEl.remove();
      appendMessage('assistant', '❌ Erro de conexão: ' + err.message);
    } finally {
      isLoading = false;
      sendEl.disabled = !inputEl.value.trim();
    }
  }

  function appendMessage(role, content, isMarkdown = false) {
    const div = document.createElement('div');
    div.className = `ai-msg ${role}`;
    div.innerHTML = isMarkdown ? mdToHtml(content) : escHtml(content);
    messagesEl.appendChild(div);
    scrollToBottom();
  }

  function scrollToBottom() {
    requestAnimationFrame(() => {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    });
  }

  function escHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
}
