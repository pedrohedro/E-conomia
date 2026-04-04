-- ============================================================================
-- E-CONOMIA: Migration 00008 - Row Level Security (RLS)
-- Isolamento multi-tenant: cada usuário só acessa dados de suas organizações
-- ============================================================================

-- Habilitar RLS em todas as tabelas
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketplace_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE channel_stock ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_flow_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketplace_payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_sales_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE regional_sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE health_scores ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- PROFILES: usuário vê e edita apenas seu próprio perfil
-- ============================================================================
CREATE POLICY profiles_select ON profiles
  FOR SELECT USING (id = auth.uid());

CREATE POLICY profiles_update ON profiles
  FOR UPDATE USING (id = auth.uid());

-- ============================================================================
-- ORGANIZATIONS: membros podem ver suas organizações
-- ============================================================================
CREATE POLICY orgs_select ON organizations
  FOR SELECT USING (id IN (SELECT get_user_org_ids()));

CREATE POLICY orgs_insert ON organizations
  FOR INSERT WITH CHECK (true);
  -- Qualquer usuário autenticado pode criar uma org (validar no app)

CREATE POLICY orgs_update ON organizations
  FOR UPDATE USING (
    id IN (SELECT get_user_org_ids())
    AND user_has_role(id, 'admin')
  );

-- ============================================================================
-- ORG_MEMBERS: membros veem outros membros da mesma org
-- ============================================================================
CREATE POLICY org_members_select ON org_members
  FOR SELECT USING (organization_id IN (SELECT get_user_org_ids()));

CREATE POLICY org_members_insert ON org_members
  FOR INSERT WITH CHECK (
    user_has_role(organization_id, 'admin')
  );

CREATE POLICY org_members_update ON org_members
  FOR UPDATE USING (
    user_has_role(organization_id, 'admin')
  );

CREATE POLICY org_members_delete ON org_members
  FOR DELETE USING (
    user_has_role(organization_id, 'owner')
    OR user_id = auth.uid()  -- Membro pode sair da org
  );

-- ============================================================================
-- MACRO: Política padrão para tabelas com organization_id
-- Leitura: membro da org | Escrita: manager+ da org
-- ============================================================================

-- MARKETPLACE_INTEGRATIONS
CREATE POLICY integrations_select ON marketplace_integrations
  FOR SELECT USING (organization_id IN (SELECT get_user_org_ids()));

CREATE POLICY integrations_insert ON marketplace_integrations
  FOR INSERT WITH CHECK (user_has_role(organization_id, 'admin'));

CREATE POLICY integrations_update ON marketplace_integrations
  FOR UPDATE USING (user_has_role(organization_id, 'admin'));

CREATE POLICY integrations_delete ON marketplace_integrations
  FOR DELETE USING (user_has_role(organization_id, 'owner'));

-- SYNC_LOGS (somente leitura para membros)
CREATE POLICY sync_logs_select ON sync_logs
  FOR SELECT USING (organization_id IN (SELECT get_user_org_ids()));

-- SUPPLIERS
CREATE POLICY suppliers_select ON suppliers
  FOR SELECT USING (organization_id IN (SELECT get_user_org_ids()));

CREATE POLICY suppliers_mutate ON suppliers
  FOR ALL USING (user_has_role(organization_id, 'manager'));

-- PRODUCTS
CREATE POLICY products_select ON products
  FOR SELECT USING (organization_id IN (SELECT get_user_org_ids()));

CREATE POLICY products_mutate ON products
  FOR ALL USING (user_has_role(organization_id, 'manager'));

-- CHANNEL_STOCK
CREATE POLICY channel_stock_select ON channel_stock
  FOR SELECT USING (organization_id IN (SELECT get_user_org_ids()));

CREATE POLICY channel_stock_mutate ON channel_stock
  FOR ALL USING (user_has_role(organization_id, 'manager'));

-- STOCK_MOVEMENTS
CREATE POLICY stock_movements_select ON stock_movements
  FOR SELECT USING (organization_id IN (SELECT get_user_org_ids()));

CREATE POLICY stock_movements_insert ON stock_movements
  FOR INSERT WITH CHECK (user_has_role(organization_id, 'manager'));

-- CUSTOMERS
CREATE POLICY customers_select ON customers
  FOR SELECT USING (organization_id IN (SELECT get_user_org_ids()));

CREATE POLICY customers_mutate ON customers
  FOR ALL USING (user_has_role(organization_id, 'manager'));

-- ORDERS
CREATE POLICY orders_select ON orders
  FOR SELECT USING (organization_id IN (SELECT get_user_org_ids()));

CREATE POLICY orders_mutate ON orders
  FOR ALL USING (user_has_role(organization_id, 'manager'));

-- ORDER_ITEMS
CREATE POLICY order_items_select ON order_items
  FOR SELECT USING (organization_id IN (SELECT get_user_org_ids()));

CREATE POLICY order_items_mutate ON order_items
  FOR ALL USING (user_has_role(organization_id, 'manager'));

-- EXPENSE_CATEGORIES
CREATE POLICY expense_categories_select ON expense_categories
  FOR SELECT USING (organization_id IN (SELECT get_user_org_ids()));

CREATE POLICY expense_categories_mutate ON expense_categories
  FOR ALL USING (user_has_role(organization_id, 'admin'));

-- EXPENSES
CREATE POLICY expenses_select ON expenses
  FOR SELECT USING (organization_id IN (SELECT get_user_org_ids()));

CREATE POLICY expenses_mutate ON expenses
  FOR ALL USING (user_has_role(organization_id, 'manager'));

-- CASH_FLOW_ENTRIES
CREATE POLICY cashflow_select ON cash_flow_entries
  FOR SELECT USING (organization_id IN (SELECT get_user_org_ids()));

CREATE POLICY cashflow_mutate ON cash_flow_entries
  FOR ALL USING (user_has_role(organization_id, 'manager'));

-- MARKETPLACE_PAYOUTS
CREATE POLICY payouts_select ON marketplace_payouts
  FOR SELECT USING (organization_id IN (SELECT get_user_org_ids()));

CREATE POLICY payouts_mutate ON marketplace_payouts
  FOR ALL USING (user_has_role(organization_id, 'admin'));

-- DAILY_SALES_METRICS
CREATE POLICY metrics_select ON daily_sales_metrics
  FOR SELECT USING (organization_id IN (SELECT get_user_org_ids()));

CREATE POLICY metrics_mutate ON daily_sales_metrics
  FOR ALL USING (user_has_role(organization_id, 'admin'));

-- REGIONAL_SALES
CREATE POLICY regional_select ON regional_sales
  FOR SELECT USING (organization_id IN (SELECT get_user_org_ids()));

-- HEALTH_SCORES
CREATE POLICY health_select ON health_scores
  FOR SELECT USING (organization_id IN (SELECT get_user_org_ids()));
