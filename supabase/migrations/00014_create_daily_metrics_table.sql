-- ============================================================================
-- E-CONOMIA: Migration 00014 - daily_metrics table
-- ============================================================================

-- daily_metrics: armazena KPIs diários pré-calculados pelo cron
CREATE TABLE IF NOT EXISTS daily_metrics (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  metric_date     DATE NOT NULL,
  total_orders    INTEGER DEFAULT 0,
  total_revenue   NUMERIC(12,2) DEFAULT 0,
  total_expenses  NUMERIC(12,2) DEFAULT 0,
  new_customers   INTEGER DEFAULT 0,
  avg_ticket      NUMERIC(12,2) DEFAULT 0,
  top_marketplace TEXT,
  created_at      TIMESTAMPTZ DEFAULT now(),
  
  UNIQUE(organization_id, metric_date)
);

CREATE INDEX IF NOT EXISTS idx_daily_metrics_org_date 
ON daily_metrics(organization_id, metric_date DESC);

ALTER TABLE daily_metrics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS daily_metrics_select ON daily_metrics;
CREATE POLICY daily_metrics_select ON daily_metrics
  FOR SELECT USING (organization_id IN (SELECT get_user_org_ids()));
