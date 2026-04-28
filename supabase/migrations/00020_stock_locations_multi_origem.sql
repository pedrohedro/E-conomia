-- ============================================================================
-- E-CONOMIA: Migration 00020 — Stock Locations Multi-Origem (ECOM-74)
-- Tabela stock_locations para rastrear estoque por localização física
-- Suporta: meli_facility (Full), seller_warehouse (Flex/Próprio), flex_origin
-- ============================================================================

-- Tabela de localizações físicas de estoque
CREATE TABLE IF NOT EXISTS stock_locations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  product_id       UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  channel_stock_id UUID REFERENCES channel_stock(id) ON DELETE SET NULL,

  -- Tipo de localização
  location_type    TEXT NOT NULL
    CHECK (location_type IN ('meli_facility', 'seller_warehouse', 'flex_origin')),

  -- Identificador externo (ex: ID do CD do ML)
  location_id      TEXT,
  location_name    TEXT,   -- "Centro de Distribuição SP", "Meu Galpão", etc.

  -- Quantidades
  quantity         INT NOT NULL DEFAULT 0,
  reserved         INT NOT NULL DEFAULT 0,
  available        INT GENERATED ALWAYS AS (GREATEST(quantity - reserved, 0)) STORED,

  -- Metadados de sync
  external_id      TEXT,     -- ID na origem (ML facility ID, etc.)
  last_synced_at   TIMESTAMPTZ,
  sync_source      TEXT DEFAULT 'manual', -- 'webhook', 'cron', 'manual'

  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(product_id, location_type, location_id)
);

COMMENT ON TABLE stock_locations IS
  'Estoque por localização física multi-origem. Um produto pode ter N localizações (Full + Flex + Próprio).';

-- Índices
CREATE INDEX IF NOT EXISTS idx_sl_org          ON stock_locations(organization_id);
CREATE INDEX IF NOT EXISTS idx_sl_product      ON stock_locations(product_id);
CREATE INDEX IF NOT EXISTS idx_sl_channel      ON stock_locations(channel_stock_id);
CREATE INDEX IF NOT EXISTS idx_sl_type         ON stock_locations(organization_id, location_type);
CREATE INDEX IF NOT EXISTS idx_sl_external     ON stock_locations(organization_id, external_id)
  WHERE external_id IS NOT NULL;

-- ============================================================================
-- RLS Policies
-- ============================================================================

ALTER TABLE stock_locations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_members_view_stock_locations" ON stock_locations;
CREATE POLICY "org_members_view_stock_locations" ON stock_locations
  FOR SELECT USING (
    organization_id IN (
      SELECT organization_id FROM org_members
      WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "org_members_manage_stock_locations" ON stock_locations;
CREATE POLICY "org_members_manage_stock_locations" ON stock_locations
  FOR ALL USING (
    organization_id IN (
      SELECT organization_id FROM org_members
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin', 'manager')
    )
  );

-- Permite service_role (Edge Functions) gerenciar sem RLS
DROP POLICY IF EXISTS "service_role_all_stock_locations" ON stock_locations;
CREATE POLICY "service_role_all_stock_locations" ON stock_locations
  FOR ALL USING (auth.role() = 'service_role');

-- ============================================================================
-- Trigger de atualização de updated_at
-- ============================================================================

DROP TRIGGER IF EXISTS trg_stock_locations_updated_at ON stock_locations;
CREATE TRIGGER trg_stock_locations_updated_at
  BEFORE UPDATE ON stock_locations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================================
-- View consolidada: estoque por produto com breakdown de origens
-- ============================================================================

CREATE OR REPLACE VIEW vw_stock_by_origin AS
SELECT
  p.id           AS product_id,
  p.organization_id,
  p.sku,
  p.name,
  p.min_stock,
  p.stock_alert,
  p.total_stock,

  -- Subtotais por tipo de origem
  COALESCE(SUM(sl.quantity) FILTER (WHERE sl.location_type = 'meli_facility'),  0) AS qty_ml_full,
  COALESCE(SUM(sl.quantity) FILTER (WHERE sl.location_type = 'flex_origin'),    0) AS qty_ml_flex,
  COALESCE(SUM(sl.quantity) FILTER (WHERE sl.location_type = 'seller_warehouse'),0) AS qty_proprio,

  -- Disponível (descontando reservas)
  COALESCE(SUM(sl.available) FILTER (WHERE sl.location_type = 'meli_facility'),  0) AS avail_ml_full,
  COALESCE(SUM(sl.available) FILTER (WHERE sl.location_type = 'flex_origin'),    0) AS avail_ml_flex,
  COALESCE(SUM(sl.available) FILTER (WHERE sl.location_type = 'seller_warehouse'),0) AS avail_proprio,

  MAX(sl.last_synced_at) AS last_synced_at

FROM products p
LEFT JOIN stock_locations sl
  ON sl.product_id = p.id
  AND sl.organization_id = p.organization_id
GROUP BY p.id, p.organization_id, p.sku, p.name, p.min_stock, p.stock_alert, p.total_stock;

COMMENT ON VIEW vw_stock_by_origin IS
  'Estoque consolidado por produto com breakdown Full/Flex/Próprio.';

-- ============================================================================
-- Migração dos dados existentes de channel_stock → stock_locations
-- ============================================================================

-- channel_stock.channel é marketplace_type (mercado_livre, amazon, ...).
-- Sem distinção entre Full/Flex no schema atual, todo channel_stock vira seller_warehouse.
-- Sync futura via webhooks/cron preencherá meli_facility/flex_origin corretamente.
INSERT INTO stock_locations (
  organization_id, product_id, channel_stock_id,
  location_type, location_name,
  quantity, reserved,
  external_id, sync_source
)
SELECT
  cs.organization_id,
  cs.product_id,
  cs.id AS channel_stock_id,
  'seller_warehouse'::text AS location_type,
  CASE cs.channel::text
    WHEN 'mercado_livre' THEN 'Mercado Livre'
    WHEN 'amazon'        THEN 'Amazon'
    WHEN 'nuvemshop'     THEN 'Nuvemshop'
    WHEN 'shopee'        THEN 'Shopee'
    WHEN 'shopify'       THEN 'Shopify'
    WHEN 'tiktok_shop'   THEN 'TikTok Shop'
    WHEN 'olx'           THEN 'OLX'
    ELSE                      'Estoque Próprio'
  END AS location_name,
  cs.quantity,
  cs.reserved,
  cs.marketplace_sku AS external_id,
  'migration' AS sync_source
FROM channel_stock cs
ON CONFLICT (product_id, location_type, location_id) DO NOTHING;
