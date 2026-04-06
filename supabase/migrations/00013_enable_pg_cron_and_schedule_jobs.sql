-- ============================================================================
-- E-CONOMIA: Migration 00013 - Enable pg_cron and schedule Edge Function jobs
-- ECOM-27: Cron sync-orders (15 min)
-- ECOM-28: Cron token-refresh (30 min)
-- ECOM-35: Cron daily metrics
-- ============================================================================

-- Enable pg_cron extension
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

-- Grant usage to postgres role
GRANT USAGE ON SCHEMA cron TO postgres;

-- ============================================================================
-- Cron Jobs: invoke Edge Functions via pg_net (HTTP)
-- ============================================================================

-- Enable pg_net for HTTP calls from database
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- ECOM-27: Sync orders every 15 minutes
SELECT cron.schedule(
  'sync-orders-every-15m',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://rqmpqxguecuhrsbzcwgb.supabase.co/functions/v1/sync-orders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
    ),
    body := '{}'::jsonb
  );
  $$
);

-- ECOM-28: Token refresh every 30 minutes
SELECT cron.schedule(
  'token-refresh-every-30m',
  '*/30 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://rqmpqxguecuhrsbzcwgb.supabase.co/functions/v1/token-refresh',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
    ),
    body := '{}'::jsonb
  );
  $$
);

-- ECOM-35: Generate daily metrics at 2:00 AM BRT (5:00 AM UTC)
SELECT cron.schedule(
  'generate-daily-metrics',
  '0 5 * * *',
  $$
  INSERT INTO daily_metrics (
    organization_id, metric_date, 
    total_orders, total_revenue, total_expenses,
    new_customers, avg_ticket, top_marketplace
  )
  SELECT 
    o.organization_id,
    (CURRENT_DATE - INTERVAL '1 day')::date,
    COUNT(DISTINCT o.id),
    COALESCE(SUM(o.gross_amount), 0),
    COALESCE((
      SELECT SUM(e.amount) FROM expenses e 
      WHERE e.organization_id = o.organization_id 
      AND e.expense_date = (CURRENT_DATE - INTERVAL '1 day')::date
    ), 0),
    (
      SELECT COUNT(DISTINCT c.id) FROM customers c 
      WHERE c.organization_id = o.organization_id 
      AND c.created_at::date = (CURRENT_DATE - INTERVAL '1 day')::date
    ),
    CASE WHEN COUNT(o.id) > 0 
      THEN COALESCE(SUM(o.gross_amount), 0) / COUNT(o.id)
      ELSE 0 
    END,
    (
      SELECT o2.marketplace FROM orders o2 
      WHERE o2.organization_id = o.organization_id 
      AND o2.created_at::date = (CURRENT_DATE - INTERVAL '1 day')::date
      GROUP BY o2.marketplace 
      ORDER BY COUNT(*) DESC 
      LIMIT 1
    )
  FROM orders o
  WHERE o.created_at::date = (CURRENT_DATE - INTERVAL '1 day')::date
  GROUP BY o.organization_id
  ON CONFLICT (organization_id, metric_date) DO UPDATE SET
    total_orders = EXCLUDED.total_orders,
    total_revenue = EXCLUDED.total_revenue,
    total_expenses = EXCLUDED.total_expenses,
    new_customers = EXCLUDED.new_customers,
    avg_ticket = EXCLUDED.avg_ticket,
    top_marketplace = EXCLUDED.top_marketplace;
  $$
);
