-- ============================================================================
-- E-CONOMIA: Migration 00007 - Analytics e Métricas de Vendas
-- Snapshots diários, métricas por canal, dados regionais
-- ============================================================================

-- Métricas diárias por marketplace (snapshot diário)
CREATE TABLE daily_sales_metrics (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  metric_date     DATE NOT NULL,
  marketplace     marketplace_type,              -- NULL = consolidado

  -- Funil de vendas
  visits          INT DEFAULT 0,                 -- Visitas/impressões em anúncios
  orders_count    INT DEFAULT 0,                 -- Pedidos fechados
  conversion_rate NUMERIC(5,2) GENERATED ALWAYS AS (
    CASE WHEN visits > 0
      THEN ROUND((orders_count::NUMERIC / visits) * 100, 2)
      ELSE 0
    END
  ) STORED,

  -- Valores
  gross_revenue   NUMERIC(12,2) DEFAULT 0,
  net_revenue     NUMERIC(12,2) DEFAULT 0,
  avg_ticket      NUMERIC(12,2) DEFAULT 0,
  total_fees      NUMERIC(12,2) DEFAULT 0,
  ads_cost        NUMERIC(12,2) DEFAULT 0,       -- Custo de ADS/publicidade

  -- Logística
  orders_preparing    INT DEFAULT 0,
  orders_packed       INT DEFAULT 0,
  orders_shipped      INT DEFAULT 0,
  orders_delivered    INT DEFAULT 0,
  fulfillment_rate    NUMERIC(5,2) DEFAULT 0,    -- % de entregas no prazo

  -- Calculado
  roi_ads         NUMERIC(5,2) GENERATED ALWAYS AS (
    CASE WHEN ads_cost > 0
      THEN ROUND(((net_revenue - ads_cost) / ads_cost) * 100, 2)
      ELSE 0
    END
  ) STORED,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(organization_id, metric_date, marketplace)
);

COMMENT ON TABLE daily_sales_metrics IS 'Snapshot diário de métricas de vendas por canal';

CREATE INDEX idx_daily_metrics_org_date ON daily_sales_metrics(organization_id, metric_date DESC);
CREATE INDEX idx_daily_metrics_marketplace ON daily_sales_metrics(organization_id, marketplace, metric_date DESC);

-- Vendas por região (UF) - agregado diário
CREATE TABLE regional_sales (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  metric_date     DATE NOT NULL,
  state           TEXT NOT NULL,               -- UF: "SP", "MG", "RJ"
  marketplace     marketplace_type,
  orders_count    INT DEFAULT 0,
  total_revenue   NUMERIC(12,2) DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(organization_id, metric_date, state, marketplace)
);

CREATE INDEX idx_regional_org_date ON regional_sales(organization_id, metric_date DESC);

-- Health Score da organização (calculado periodicamente)
CREATE TABLE health_scores (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  score_date      DATE NOT NULL,
  overall_score   INT NOT NULL CHECK (overall_score BETWEEN 0 AND 100),
  breakdown       JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Ex: {financial: 90, stock: 85, logistics: 95, reputation: 88}
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(organization_id, score_date)
);

CREATE INDEX idx_health_scores_org ON health_scores(organization_id, score_date DESC);

-- ============================================================================
-- View: Performance consolidada por marketplace (para comparação)
-- ============================================================================
CREATE OR REPLACE VIEW v_marketplace_performance AS
SELECT
  organization_id,
  marketplace,
  SUM(orders_count) AS total_orders,
  SUM(gross_revenue) AS total_gross,
  SUM(net_revenue) AS total_net,
  SUM(total_fees) AS total_fees,
  AVG(avg_ticket) AS avg_ticket,
  AVG(conversion_rate) AS avg_conversion,
  AVG(fulfillment_rate) AS avg_fulfillment
FROM daily_sales_metrics
WHERE metric_date >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY organization_id, marketplace;
