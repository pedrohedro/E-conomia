// =============================================================================
// E-CONOMIA: API de dados reais do Supabase
// Substitui todos os dados mockados nas páginas
// =============================================================================

import { supabase } from './supabase-client.js';

const fmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

// Formatar valor monetário
export function formatCurrency(value) {
  return fmt.format(value ?? 0);
}

// Formatar percentual
export function formatPercent(value, decimals = 1) {
  return `${(value ?? 0).toFixed(decimals)}%`;
}

// =============================================================================
// DASHBOARD: KPIs por marketplace (mês atual)
// =============================================================================

/**
 * Retorna KPIs consolidados ou por marketplace para o mês corrente.
 * @param {string} orgId  - UUID da organização
 * @param {string|null} marketplace - 'mercado_livre' | 'nuvemshop' | 'amazon' | 'shopee' | null (geral)
 */
export async function fetchDashboardKPIs(orgId, marketplace = null) {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
  const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59).toISOString();

  let query = supabase
    .from('orders')
    .select('gross_amount, marketplace_fee_amt, status, marketplace, created_at')
    .eq('organization_id', orgId)
    .gte('created_at', startOfMonth)
    .neq('status', 'cancelled');

  if (marketplace) {
    query = query.eq('marketplace', marketplace);
  }

  const { data: currentOrders, error } = await query;
  if (error) throw error;

  // Mês anterior para variação %
  let queryLast = supabase
    .from('orders')
    .select('gross_amount')
    .eq('organization_id', orgId)
    .gte('created_at', startOfLastMonth)
    .lte('created_at', endOfLastMonth)
    .neq('status', 'cancelled');

  if (marketplace) queryLast = queryLast.eq('marketplace', marketplace);

  const { data: lastOrders } = await queryLast;

  const totalVendas = (currentOrders ?? []).reduce((sum, o) => sum + (o.gross_amount ?? 0), 0);
  const totalTaxas = (currentOrders ?? []).reduce((sum, o) => sum + (o.marketplace_fee_amt ?? 0), 0);
  const totalLastMonth = (lastOrders ?? []).reduce((sum, o) => sum + (o.gross_amount ?? 0), 0);
  const variation = totalLastMonth > 0
    ? ((totalVendas - totalLastMonth) / totalLastMonth) * 100
    : null;

  const percentTaxa = totalVendas > 0 ? (totalTaxas / totalVendas) * 100 : 0;

  return {
    vendas: formatCurrency(totalVendas),
    vendasRaw: totalVendas,
    taxas: formatCurrency(totalTaxas),
    percentTaxa: `${formatPercent(percentTaxa)} de taxas`,
    variation: variation !== null ? `${variation >= 0 ? '+' : ''}${formatPercent(variation)} vs mês ant.` : 'Sem dados ant.',
    variationPositive: variation === null ? null : variation >= 0,
    ordersCount: (currentOrders ?? []).length,
  };
}

// =============================================================================
// DASHBOARD: Dados de gráfico (faturamento mensal últimos 12 meses)
// =============================================================================

/**
 * Retorna array [Jan, Fev, ...] com faturamento bruto por mês (em mil reais).
 */
export async function fetchMonthlyRevenue(orgId, marketplace = null) {
  const twelveMonthsAgo = new Date();
  twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 11);
  twelveMonthsAgo.setDate(1);
  twelveMonthsAgo.setHours(0, 0, 0, 0);

  let query = supabase
    .from('orders')
    .select('gross_amount, created_at')
    .eq('organization_id', orgId)
    .gte('created_at', twelveMonthsAgo.toISOString())
    .neq('status', 'cancelled');

  if (marketplace) query = query.eq('marketplace', marketplace);

  const { data, error } = await query;
  if (error) throw error;

  const monthly = new Array(12).fill(0);
  const now = new Date();

  (data ?? []).forEach(order => {
    const d = new Date(order.created_at);
    const diffMonths = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
    const idx = 11 - diffMonths;
    if (idx >= 0 && idx < 12) {
      monthly[idx] += (order.gross_amount ?? 0) / 1000; // em mil
    }
  });

  return monthly.map(v => Math.round(v * 10) / 10);
}

// =============================================================================
// DASHBOARD: Marketplaces conectados
// =============================================================================

/**
 * Retorna as integrações ativas da organização.
 */
export async function fetchActiveIntegrations(orgId) {
  const { data, error } = await supabase
    .from('marketplace_integrations')
    .select('marketplace, status, seller_nickname, last_sync_at, last_sync_error')
    .eq('organization_id', orgId)
    .eq('status', 'active');

  if (error) throw error;
  return data ?? [];
}

// =============================================================================
// DASHBOARD: Status por marketplace (para os cards de tab)
// =============================================================================

export async function fetchMarketplaceStatus(orgId, marketplace) {
  const { data, error } = await supabase
    .from('marketplace_integrations')
    .select('seller_nickname, status, last_sync_at, last_sync_error, config')
    .eq('organization_id', orgId)
    .eq('marketplace', marketplace)
    .eq('status', 'active')
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const statusLabels = {
    mercado_livre: 'ML ATIVO',
    nuvemshop: 'NUVEM ATIVO',
    amazon: 'AMAZON ATIVO',
    shopee: 'SHOPEE ATIVO',
  };

  const syncAgo = data.last_sync_at
    ? getTimeAgo(new Date(data.last_sync_at))
    : 'Nunca sincronizado';

  return {
    status: statusLabels[marketplace] || 'ATIVO',
    subStatus: data.last_sync_error ? `Erro: ${data.last_sync_error.slice(0, 30)}` : `Sync: ${syncAgo}`,
    hasError: !!data.last_sync_error,
    sellerName: data.seller_nickname,
  };
}

function getTimeAgo(date) {
  const mins = Math.floor((Date.now() - date.getTime()) / 60000);
  if (mins < 1) return 'agora';
  if (mins < 60) return `${mins}min atrás`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h atrás`;
  return `${Math.floor(h / 24)}d atrás`;
}

// =============================================================================
// ESTOQUE: Produtos com estoque baixo / crítico
// =============================================================================

export async function fetchInventoryPreview(orgId, limit = 10) {
  const { data, error } = await supabase
    .from('products')
    .select(`
      id, name, sku, sale_price, cost_price, margin_percent,
      total_stock, stock_alert, is_active,
      channel_stock(channel, available, quantity, reserved)
    `)
    .eq('organization_id', orgId)
    .eq('is_active', true)
    .order('total_stock', { ascending: true })
    .limit(limit);

  if (error) throw error;
  return data ?? [];
}

// =============================================================================
// VENDAS: Últimos pedidos
// =============================================================================

export async function fetchRecentOrders(orgId, limit = 20, marketplace = null) {
  let query = supabase
    .from('orders')
    .select(`
      id, order_number, marketplace, status, gross_amount, net_amount,
      marketplace_fee_amt, created_at,
      customers(name)
    `)
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (marketplace) query = query.eq('marketplace', marketplace);

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

// =============================================================================
// FINANCEIRO: Resumo fluxo de caixa (mês atual)
// =============================================================================

export async function fetchFinancialSummary(orgId) {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const [ordersRes, expensesRes, payoutsRes] = await Promise.all([
    supabase
      .from('orders')
      .select('gross_amount, net_amount, marketplace_fee_amt')
      .eq('organization_id', orgId)
      .gte('created_at', startOfMonth)
      .neq('status', 'cancelled'),
    supabase
      .from('expenses')
      .select('amount, is_paid')
      .eq('organization_id', orgId)
      .gte('due_date', startOfMonth.slice(0, 10)),
    supabase
      .from('marketplace_payouts')
      .select('net_amount, status, marketplace')
      .eq('organization_id', orgId)
      .gte('payout_date', startOfMonth.slice(0, 10))
  ]);

  const orders = ordersRes.data ?? [];
  const expenses = expensesRes.data ?? [];
  const payouts = payoutsRes.data ?? [];

  const receita = orders.reduce((s, o) => s + (o.gross_amount ?? 0), 0);
  const taxas = orders.reduce((s, o) => s + (o.marketplace_fee_amt ?? 0), 0);
  const despesas = expenses.reduce((s, e) => s + (e.amount ?? 0), 0);
  const despesasPagas = expenses.filter(e => e.is_paid).reduce((s, e) => s + (e.amount ?? 0), 0);
  const recebimentos = payouts.filter(p => p.status === 'paid').reduce((s, p) => s + (p.net_amount ?? 0), 0);
  const caixa = payouts.reduce((s, p) => s + (p.net_amount ?? 0), 0);
  const lucroEstimado = receita - taxas - despesas;

  return {
    receita: formatCurrency(receita),
    taxas: formatCurrency(taxas),
    despesas: formatCurrency(despesas),
    despesasPagas: formatCurrency(despesasPagas),
    recebimentos: formatCurrency(recebimentos),
    caixa: formatCurrency(caixa),
    lucroEstimado: formatCurrency(lucroEstimado),
    lucroPositivo: lucroEstimado >= 0,
  };
}

// =============================================================================
// Helper: Banner "Sem integrações"
// =============================================================================

export function renderNoIntegrations(container, message = 'Nenhum marketplace conectado.') {
  container.innerHTML = `
    <div class="flex flex-col items-center justify-center py-16 text-center">
      <div class="w-16 h-16 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mb-4">
        <svg class="w-8 h-8 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
            d="M13 10V3L4 14h7v7l9-11h-7z"/>
        </svg>
      </div>
      <p class="text-white font-semibold text-lg mb-1">${message}</p>
      <p class="text-gray-500 text-sm mb-6">Conecte um canal de vendas para ver os dados reais.</p>
      <a href="index.html" class="px-5 py-2.5 bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-semibold rounded-xl transition-colors">
        Conectar Marketplace
      </a>
    </div>
  `;
}

// =============================================================================
// Helper: Skeleton loader
// =============================================================================

export function showSkeletons(ids) {
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.dataset.original = el.textContent;
      el.innerHTML = '<span class="inline-block w-24 h-6 bg-white/10 rounded animate-pulse"></span>';
    }
  });
}

export function hideSkeletons(ids) {
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el && el.dataset.original !== undefined) {
      // será preenchido com dado real pelo chamador
    }
  });
}

// =============================================================================
// ESTOQUE: Todos os produtos com filtros (para estoque.html)
// =============================================================================

/**
 * Retorna todos os produtos ativos com estoque e channel_stock filtrados.
 * @param {string} orgId - UUID da organização
 * @param {object} opts
 * @param {string} opts.search - filtro por nome (ilike)
 * @param {string} opts.stockFilter - 'all' | 'critical' | 'ok' | 'empty'
 * @param {string|null} opts.marketplace - filtrar por marketplace (ex: 'mercado_livre')
 */
export async function fetchAllInventory(orgId, { search = '', stockFilter = 'all', marketplace = null } = {}) {
  let q = supabase
    .from('products')
    .select('id, name, sku, sale_price, cost_price, margin_percent, total_stock, stock_alert, is_active, channel_stock(channel, available, quantity, reserved)')
    .eq('organization_id', orgId)
    .eq('is_active', true)
    .order('stock_alert', { ascending: false })
    .order('total_stock', { ascending: true });

  if (search) q = q.ilike('name', `%${search}%`);
  if (stockFilter === 'critical') q = q.in('stock_alert', ['critical', 'low', 'out_of_stock']);
  if (stockFilter === 'ok') q = q.eq('stock_alert', 'normal').gt('total_stock', 0);
  if (stockFilter === 'empty') q = q.eq('total_stock', 0);

  const { data, error } = await q;
  if (error) throw error;

  let products = data ?? [];

  // Filtro por marketplace: manter apenas produtos que possuem channel_stock nesse marketplace
  if (marketplace) {
    products = products.filter(p =>
      (p.channel_stock ?? []).some(cs => cs.channel === marketplace)
    );
  }

  return products;
}

// =============================================================================
// CONTÁBIL: Despesas do mês
// =============================================================================

/**
 * Retorna todas as despesas de um mês específico (índice 0-11, padrão = mês atual).
 * @param {string} orgId
 * @param {number|null} month - índice 0-11 ou null para mês atual
 */
export async function fetchExpenses(orgId, month) {
  const year = new Date().getFullYear();
  const m = month ?? new Date().getMonth();
  const start = new Date(year, m, 1).toISOString().slice(0, 10);
  const end = new Date(year, m + 1, 0).toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from('expenses')
    .select('id, description, amount, due_date, is_paid, expense_type, marketplace, expense_categories(name, icon, color)')
    .eq('organization_id', orgId)
    .gte('due_date', start)
    .lte('due_date', end)
    .order('due_date');

  if (error) throw error;
  return data ?? [];
}

// =============================================================================
// CONTÁBIL: Repasses de marketplace (payouts)
// =============================================================================

/**
 * Retorna os repasses de marketplace de um mês específico (índice 0-11, padrão = mês atual).
 * @param {string} orgId
 * @param {number|null} month - índice 0-11 ou null para mês atual
 */
export async function fetchPayouts(orgId, month) {
  const year = new Date().getFullYear();
  const m = month ?? new Date().getMonth();
  const start = new Date(year, m, 1).toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from('marketplace_payouts')
    .select('id, marketplace, payout_date, amount, net_amount, fee_amount, status')
    .eq('organization_id', orgId)
    .gte('payout_date', start)
    .order('payout_date', { ascending: false });

  if (error) throw error;
  return data ?? [];
}
