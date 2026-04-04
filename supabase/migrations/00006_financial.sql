-- ============================================================================
-- E-CONOMIA: Migration 00006 - Módulo Financeiro / Contábil
-- Despesas, fluxo de caixa, DRE simplificado
-- ============================================================================

-- Categorias de despesa (customizáveis por organização)
CREATE TABLE expense_categories (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,                -- "Aluguel", "Fornecedores", "Ads"
  icon            TEXT,                         -- Nome do ícone Lucide
  color           TEXT,                         -- Cor hex para o frontend
  is_default      BOOLEAN DEFAULT false,        -- Categorias padrão do sistema
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_expense_categories_org ON expense_categories(organization_id);

-- Despesas e custos
CREATE TABLE expenses (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  category_id     UUID REFERENCES expense_categories(id) ON DELETE SET NULL,

  expense_type    expense_type NOT NULL DEFAULT 'variable',
  description     TEXT NOT NULL,                -- "Fornecedor: Dux Nutrition"
  amount          NUMERIC(12,2) NOT NULL,       -- Valor total

  -- Parcelas
  installments    INT DEFAULT 1,                -- Quantidade de parcelas
  current_installment INT DEFAULT 1,            -- Parcela atual (para recorrentes)

  -- Datas
  due_date        DATE NOT NULL,                -- Data de vencimento
  paid_at         TIMESTAMPTZ,                  -- Data efetiva do pagamento
  is_paid         BOOLEAN DEFAULT false,

  -- Origem
  marketplace     marketplace_type,             -- Marketplace associado (opcional)
  payment_method  payment_method,

  -- Recorrência
  is_recurring    BOOLEAN DEFAULT false,
  recurrence_day  INT,                          -- Dia do mês (1-31) para custos fixos

  notes           TEXT,
  created_by      UUID REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE expenses IS 'Despesas, custos fixos, variáveis e pró-labore';

CREATE INDEX idx_expenses_org ON expenses(organization_id);
CREATE INDEX idx_expenses_type ON expenses(organization_id, expense_type);
CREATE INDEX idx_expenses_due ON expenses(organization_id, due_date);
CREATE INDEX idx_expenses_unpaid ON expenses(organization_id, is_paid, due_date)
  WHERE is_paid = false;
CREATE INDEX idx_expenses_marketplace ON expenses(organization_id, marketplace)
  WHERE marketplace IS NOT NULL;

-- Fluxo de Caixa (entradas e saídas diárias)
-- Materialização de eventos para o calendário financeiro
CREATE TABLE cash_flow_entries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entry_type      financial_entry_type NOT NULL,   -- income / expense
  entry_date      DATE NOT NULL,                   -- Data da movimentação
  amount          NUMERIC(12,2) NOT NULL,           -- Valor (sempre positivo)
  description     TEXT NOT NULL,
  marketplace     marketplace_type,                -- Origem marketplace (null = geral)
  reference_type  TEXT,                             -- 'order', 'expense', 'repasse', 'manual'
  reference_id    UUID,                             -- ID do pedido ou despesa
  is_confirmed    BOOLEAN DEFAULT false,            -- Confirmado (realizado) vs previsto
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE cash_flow_entries IS 'Calendário financeiro: entradas e saídas por dia';

CREATE INDEX idx_cashflow_org_date ON cash_flow_entries(organization_id, entry_date);
CREATE INDEX idx_cashflow_type ON cash_flow_entries(organization_id, entry_type, entry_date);
CREATE INDEX idx_cashflow_marketplace ON cash_flow_entries(organization_id, marketplace, entry_date)
  WHERE marketplace IS NOT NULL;

-- Repasses de marketplace (quando o marketplace paga o vendedor)
CREATE TABLE marketplace_payouts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  integration_id  UUID REFERENCES marketplace_integrations(id) ON DELETE SET NULL,
  marketplace     marketplace_type NOT NULL,
  payout_date     DATE NOT NULL,                    -- Data do repasse
  gross_amount    NUMERIC(12,2) NOT NULL,            -- Valor bruto
  fees_amount     NUMERIC(12,2) DEFAULT 0,           -- Taxas retidas
  net_amount      NUMERIC(12,2) NOT NULL,            -- Valor líquido recebido
  order_count     INT DEFAULT 0,                     -- Qtd de pedidos no repasse
  marketplace_ref TEXT,                              -- Referência do repasse no marketplace
  is_confirmed    BOOLEAN DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_payouts_org ON marketplace_payouts(organization_id, payout_date DESC);
CREATE INDEX idx_payouts_marketplace ON marketplace_payouts(organization_id, marketplace);

-- ============================================================================
-- View Materializada: KPIs Financeiros Mensais (para dashboard)
-- ============================================================================
CREATE OR REPLACE VIEW v_monthly_financial_summary AS
SELECT
  o.organization_id,
  DATE_TRUNC('month', o.marketplace_created_at) AS month,
  o.marketplace,
  COUNT(*)                                      AS total_orders,
  SUM(o.gross_amount)                           AS gross_revenue,
  SUM(o.net_amount)                             AS net_revenue,
  SUM(o.marketplace_fee_amt)                    AS total_fees,
  AVG(o.gross_amount)                           AS avg_ticket,
  SUM(oi.cost_total)                            AS total_cogs
FROM orders o
LEFT JOIN LATERAL (
  SELECT SUM(oi2.cost_price * oi2.quantity) AS cost_total
  FROM order_items oi2
  WHERE oi2.order_id = o.id
) oi ON true
WHERE o.status NOT IN ('cancelled', 'returned')
GROUP BY o.organization_id, DATE_TRUNC('month', o.marketplace_created_at), o.marketplace;

-- View: Resumo de despesas por tipo e mês
CREATE OR REPLACE VIEW v_monthly_expenses AS
SELECT
  organization_id,
  DATE_TRUNC('month', due_date) AS month,
  expense_type,
  marketplace,
  COUNT(*)            AS count,
  SUM(amount)         AS total_amount,
  SUM(CASE WHEN is_paid THEN amount ELSE 0 END) AS paid_amount,
  SUM(CASE WHEN NOT is_paid THEN amount ELSE 0 END) AS pending_amount
FROM expenses
GROUP BY organization_id, DATE_TRUNC('month', due_date), expense_type, marketplace;

CREATE TRIGGER trg_expenses_updated_at
  BEFORE UPDATE ON expenses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
