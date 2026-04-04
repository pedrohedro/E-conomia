-- ============================================================
-- Migration 00011: Stripe Subscriptions
-- ============================================================

CREATE TABLE IF NOT EXISTS subscriptions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  stripe_customer_id      TEXT,
  stripe_subscription_id  TEXT UNIQUE,
  plan            TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'starter', 'pro', 'enterprise')),
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'trialing', 'past_due', 'canceled', 'unpaid', 'incomplete')),
  current_period_start TIMESTAMPTZ,
  current_period_end   TIMESTAMPTZ,
  trial_end            TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN DEFAULT FALSE,
  canceled_at          TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_org ON subscriptions(organization_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_customer ON subscriptions(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_sub ON subscriptions(stripe_subscription_id);

CREATE TRIGGER set_subscriptions_updated_at
  BEFORE UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_members_read_subscription" ON subscriptions
  FOR SELECT USING (
    organization_id IN (
      SELECT organization_id FROM org_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "service_role_write_subscription" ON subscriptions
  FOR ALL USING (auth.role() = 'service_role');

INSERT INTO subscriptions (organization_id, plan, status)
SELECT id, 'free', 'active' FROM organizations o
WHERE NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.organization_id = o.id);

-- Faturas
CREATE TABLE IF NOT EXISTS stripe_invoices (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  stripe_invoice_id   TEXT UNIQUE NOT NULL,
  stripe_customer_id  TEXT,
  amount_paid         INTEGER,
  currency            TEXT DEFAULT 'brl',
  status              TEXT,
  invoice_pdf         TEXT,
  period_start        TIMESTAMPTZ,
  period_end          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE stripe_invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_members_read_invoices" ON stripe_invoices
  FOR SELECT USING (
    organization_id IN (
      SELECT organization_id FROM org_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "service_role_write_invoices" ON stripe_invoices
  FOR ALL USING (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS idx_stripe_invoices_org ON stripe_invoices(organization_id);
