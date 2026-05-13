-- ============================================================================
-- E-CONOMIA: Migration Consolidada para PostgreSQL Puro (Render)
-- Adaptada de 28 migrations Supabase — removido auth.users, RLS, Storage
-- ============================================================================

-- Extensões necessárias
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ============================================================================
-- 001: Enums e Tipos
-- ============================================================================

CREATE TYPE user_role AS ENUM ('owner', 'admin', 'manager', 'viewer');

CREATE TYPE marketplace_type AS ENUM (
  'mercado_livre', 'amazon', 'shopee', 'nuvemshop',
  'shein', 'shopify', 'tiktok_shop', 'olx',
  'erp_olist_hub', 'erp_omie'
);

CREATE TYPE integration_status AS ENUM (
  'disconnected', 'connecting', 'active', 'token_expired', 'error', 'suspended'
);

CREATE TYPE fulfillment_type AS ENUM (
  'ml_full', 'ml_flex', 'ml_coleta', 'amazon_fba', 'amazon_dba',
  'shopee_xpress', 'correios_sedex', 'correios_pac', 'transportadora', 'retirada'
);

CREATE TYPE order_status AS ENUM (
  'pending', 'approved', 'preparing', 'packed', 'shipped', 'delivered', 'cancelled', 'returned'
);

CREATE TYPE nfe_status AS ENUM ('pending', 'processing', 'issued', 'cancelled', 'denied');
CREATE TYPE shipping_label_status AS ENUM ('pending', 'generated', 'printed', 'collected');
CREATE TYPE expense_type AS ENUM ('fixed', 'variable', 'tax', 'pro_labore', 'one_time');
CREATE TYPE payment_method AS ENUM ('pix', 'boleto', 'credit_card', 'debit_card', 'bank_transfer', 'cash', 'marketplace_credit');
CREATE TYPE financial_entry_type AS ENUM ('income', 'expense');
CREATE TYPE stock_alert_level AS ENUM ('normal', 'low', 'critical', 'out_of_stock');

-- ============================================================================
-- 002: Core Tables (sem auth.users, user_id = TEXT do Clerk)
-- ============================================================================

CREATE TABLE organizations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  slug        TEXT UNIQUE NOT NULL,
  cnpj        TEXT,
  tax_regime  TEXT DEFAULT 'simples_nacional',
  tax_rate    NUMERIC(5,2) DEFAULT 6.00,
  settings    JSONB DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE profiles (
  id          TEXT PRIMARY KEY,          -- Clerk user ID (user_xxxxx)
  full_name   TEXT,
  avatar_url  TEXT,
  phone       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE org_members (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL,          -- Clerk user ID
  role            user_role NOT NULL DEFAULT 'viewer',
  invited_email   TEXT,
  invited_at      TIMESTAMPTZ,
  accepted_at     TIMESTAMPTZ,
  is_active       BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id, user_id)
);

CREATE INDEX idx_org_members_org ON org_members(organization_id);
CREATE INDEX idx_org_members_user ON org_members(user_id);
CREATE INDEX idx_org_members_active ON org_members(organization_id, is_active) WHERE is_active = true;

-- ============================================================================
-- 003: Marketplace Integrations
-- ============================================================================

CREATE TABLE marketplace_integrations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  marketplace     marketplace_type NOT NULL,
  status          integration_status NOT NULL DEFAULT 'disconnected',
  seller_id       TEXT,
  seller_nickname TEXT,
  access_token    TEXT,
  refresh_token   TEXT,
  token_expires_at TIMESTAMPTZ,
  config          JSONB DEFAULT '{}'::jsonb,
  last_sync_at    TIMESTAMPTZ,
  last_sync_error TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id, marketplace)
);

CREATE INDEX idx_integrations_org ON marketplace_integrations(organization_id);
CREATE INDEX idx_integrations_status ON marketplace_integrations(organization_id, status);

CREATE TABLE sync_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  integration_id  UUID REFERENCES marketplace_integrations(id) ON DELETE CASCADE,
  sync_type       TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'running',
  records_synced  INT DEFAULT 0,
  error_message   TEXT,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at    TIMESTAMPTZ
);

-- ============================================================================
-- 004: Products & Inventory
-- ============================================================================

CREATE TABLE suppliers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  contact_name    TEXT,
  email           TEXT,
  phone           TEXT,
  cnpj            TEXT,
  address         JSONB,
  payment_terms   TEXT,
  notes           TEXT,
  is_active       BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE products (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sku             TEXT NOT NULL,
  name            TEXT NOT NULL,
  description     TEXT,
  supplier_id     UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  cost_price      NUMERIC(12,2) NOT NULL DEFAULT 0,
  sale_price      NUMERIC(12,2) NOT NULL DEFAULT 0,
  margin_percent  NUMERIC(5,2) GENERATED ALWAYS AS (
    CASE WHEN sale_price > 0 THEN ROUND(((sale_price - cost_price) / sale_price) * 100, 2) ELSE 0 END
  ) STORED,
  total_stock     INT NOT NULL DEFAULT 0,
  min_stock       INT NOT NULL DEFAULT 10,
  stock_alert     stock_alert_level NOT NULL DEFAULT 'normal',
  weight_grams    INT,
  dimensions      JSONB,
  barcode         TEXT,
  ncm             TEXT,
  image_url       TEXT,
  category        TEXT,
  tags            TEXT[],
  is_active       BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id, sku)
);

CREATE INDEX idx_products_org ON products(organization_id);
CREATE INDEX idx_products_alert ON products(organization_id, stock_alert) WHERE stock_alert != 'normal';

CREATE TABLE channel_stock (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  product_id      UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  channel         fulfillment_type NOT NULL,
  quantity        INT NOT NULL DEFAULT 0,
  reserved        INT NOT NULL DEFAULT 0,
  available       INT GENERATED ALWAYS AS (quantity - reserved) STORED,
  channel_sku     TEXT,
  channel_url     TEXT,
  last_synced_at  TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(product_id, channel)
);

CREATE TABLE stock_movements (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  product_id      UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  channel         fulfillment_type,
  movement_type   TEXT NOT NULL,
  quantity        INT NOT NULL,
  reference_id    UUID,
  notes           TEXT,
  created_by      TEXT,              -- Clerk user ID
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- 005: Orders
-- ============================================================================

CREATE TABLE customers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  marketplace     marketplace_type,
  marketplace_buyer_id TEXT,
  name            TEXT NOT NULL,
  email           TEXT,
  phone           TEXT,
  document        TEXT,
  city            TEXT,
  state           TEXT,
  zip_code        TEXT,
  address         JSONB,
  total_orders    INT DEFAULT 0,
  total_spent     NUMERIC(12,2) DEFAULT 0,
  first_order_at  TIMESTAMPTZ,
  last_order_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_customers_marketplace_buyer ON customers(organization_id, marketplace, marketplace_buyer_id)
  WHERE marketplace_buyer_id IS NOT NULL;

CREATE TABLE orders (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  order_number        TEXT NOT NULL,
  marketplace         marketplace_type NOT NULL,
  marketplace_order_id TEXT,
  integration_id      UUID REFERENCES marketplace_integrations(id) ON DELETE SET NULL,
  customer_id         UUID REFERENCES customers(id) ON DELETE SET NULL,
  status              order_status NOT NULL DEFAULT 'pending',
  fulfillment         fulfillment_type NOT NULL,
  gross_amount        NUMERIC(12,2) NOT NULL DEFAULT 0,
  marketplace_fee_pct NUMERIC(5,2) DEFAULT 0,
  marketplace_fee_amt NUMERIC(12,2) DEFAULT 0,
  shipping_cost       NUMERIC(12,2) DEFAULT 0,
  discount_amount     NUMERIC(12,2) DEFAULT 0,
  net_amount          NUMERIC(12,2) GENERATED ALWAYS AS (
    gross_amount - marketplace_fee_amt - shipping_cost - discount_amount
  ) STORED,
  nfe_status          nfe_status DEFAULT 'pending',
  nfe_number          TEXT,
  nfe_key             TEXT,
  tracking_code       TEXT,
  carrier             TEXT,
  estimated_delivery_at TIMESTAMPTZ,
  shipped_at          TIMESTAMPTZ,
  delivered_at        TIMESTAMPTZ,
  -- ERP Fulfillment fields
  external_erp_id     TEXT,
  external_erp_status TEXT,
  raw_data            JSONB,
  marketplace_created_at TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id, marketplace, marketplace_order_id)
);

CREATE INDEX idx_orders_org ON orders(organization_id);
CREATE INDEX idx_orders_status ON orders(organization_id, status);
CREATE INDEX idx_orders_date ON orders(organization_id, marketplace_created_at DESC);

CREATE TABLE order_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  product_id      UUID REFERENCES products(id) ON DELETE SET NULL,
  sku             TEXT,
  product_name    TEXT NOT NULL,
  quantity        INT NOT NULL DEFAULT 1,
  unit_price      NUMERIC(12,2) NOT NULL,
  total_price     NUMERIC(12,2) GENERATED ALWAYS AS (quantity * unit_price) STORED,
  cost_price      NUMERIC(12,2) DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- 006: Financial
-- ============================================================================

CREATE TABLE expense_categories (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  icon            TEXT,
  color           TEXT,
  is_default      BOOLEAN DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE expenses (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  category_id     UUID REFERENCES expense_categories(id) ON DELETE SET NULL,
  expense_type    expense_type NOT NULL DEFAULT 'variable',
  description     TEXT NOT NULL,
  amount          NUMERIC(12,2) NOT NULL,
  installments    INT DEFAULT 1,
  current_installment INT DEFAULT 1,
  due_date        DATE NOT NULL,
  paid_at         TIMESTAMPTZ,
  is_paid         BOOLEAN DEFAULT false,
  marketplace     marketplace_type,
  payment_method  payment_method,
  is_recurring    BOOLEAN DEFAULT false,
  recurrence_day  INT,
  notes           TEXT,
  created_by      TEXT,              -- Clerk user ID
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE marketplace_payouts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  integration_id  UUID REFERENCES marketplace_integrations(id) ON DELETE SET NULL,
  marketplace     marketplace_type NOT NULL,
  payout_date     DATE NOT NULL,
  gross_amount    NUMERIC(12,2) NOT NULL,
  fees_amount     NUMERIC(12,2) DEFAULT 0,
  net_amount      NUMERIC(12,2) NOT NULL,
  order_count     INT DEFAULT 0,
  marketplace_ref TEXT,
  is_confirmed    BOOLEAN DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- 028: ERP Integrations (Olist Hub & Omie)
-- ============================================================================

CREATE TABLE erp_status_mapping (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  erp_type        marketplace_type NOT NULL,
  external_status TEXT NOT NULL,
  internal_status order_status NOT NULL,
  description     TEXT,
  UNIQUE(erp_type, external_status)
);

CREATE TABLE erp_sync_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  order_id        UUID REFERENCES orders(id) ON DELETE SET NULL,
  erp_type        marketplace_type NOT NULL,
  direction       TEXT NOT NULL DEFAULT 'outbound',
  method          TEXT NOT NULL,
  payload         JSONB,
  response        JSONB,
  status_code     INT,
  error_message   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed: Olist Hub status mapping
INSERT INTO erp_status_mapping (erp_type, external_status, internal_status, description) VALUES
  ('erp_olist_hub', 'released', 'approved', 'Pedido liberado para processamento'),
  ('erp_olist_hub', 'preparing', 'preparing', 'Em separação no galpão'),
  ('erp_olist_hub', 'invoiced', 'packed', 'NFe emitida, pronto para coleta'),
  ('erp_olist_hub', 'shipped', 'shipped', 'Despachado pela transportadora'),
  ('erp_olist_hub', 'delivered', 'delivered', 'Entregue ao cliente'),
  ('erp_olist_hub', 'cancelled', 'cancelled', 'Cancelado');

-- Seed: Omie status mapping
INSERT INTO erp_status_mapping (erp_type, external_status, internal_status, description) VALUES
  ('erp_omie', '10', 'pending', 'Aguardando aprovação'),
  ('erp_omie', '20', 'approved', 'Aprovado'),
  ('erp_omie', '50', 'shipped', 'Faturado e enviado'),
  ('erp_omie', '60', 'delivered', 'Entregue'),
  ('erp_omie', '90', 'cancelled', 'Cancelado');

-- ============================================================================
-- Triggers: Recálculo automático de estoque
-- ============================================================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE OR REPLACE FUNCTION recalculate_product_stock()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_product_id UUID;
  v_total INT;
  v_min INT;
  v_alert stock_alert_level;
BEGIN
  v_product_id := COALESCE(NEW.product_id, OLD.product_id);
  SELECT COALESCE(SUM(quantity), 0) INTO v_total FROM channel_stock WHERE product_id = v_product_id;
  SELECT min_stock INTO v_min FROM products WHERE id = v_product_id;
  IF v_total = 0 THEN v_alert := 'out_of_stock';
  ELSIF v_total <= (v_min * 0.5) THEN v_alert := 'critical';
  ELSIF v_total <= v_min THEN v_alert := 'low';
  ELSE v_alert := 'normal'; END IF;
  UPDATE products SET total_stock = v_total, stock_alert = v_alert, updated_at = now() WHERE id = v_product_id;
  RETURN COALESCE(NEW, OLD);
END; $$;

CREATE OR REPLACE FUNCTION update_customer_stats()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.customer_id IS NOT NULL AND NEW.status NOT IN ('cancelled', 'returned') THEN
    UPDATE customers SET
      total_orders = (SELECT COUNT(*) FROM orders WHERE customer_id = NEW.customer_id AND status NOT IN ('cancelled', 'returned')),
      total_spent = (SELECT COALESCE(SUM(gross_amount), 0) FROM orders WHERE customer_id = NEW.customer_id AND status NOT IN ('cancelled', 'returned')),
      last_order_at = (SELECT MAX(marketplace_created_at) FROM orders WHERE customer_id = NEW.customer_id),
      updated_at = now()
    WHERE id = NEW.customer_id;
  END IF;
  RETURN NEW;
END; $$;

-- Apply triggers
CREATE TRIGGER trg_channel_stock_recalculate AFTER INSERT OR UPDATE OR DELETE ON channel_stock FOR EACH ROW EXECUTE FUNCTION recalculate_product_stock();
CREATE TRIGGER trg_orders_update_customer AFTER INSERT OR UPDATE OF status ON orders FOR EACH ROW EXECUTE FUNCTION update_customer_stats();
CREATE TRIGGER trg_organizations_updated BEFORE UPDATE ON organizations FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_products_updated BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_orders_updated BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_expenses_updated BEFORE UPDATE ON expenses FOR EACH ROW EXECUTE FUNCTION update_updated_at();
