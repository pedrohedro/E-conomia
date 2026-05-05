-- ============================================================================
-- E-CONOMIA: Migration 00028 — Tiny ERP Integration (Fulfillment Parceiro)
-- ============================================================================

-- 1. Tabela para configurações do Tiny ERP
CREATE TABLE IF NOT EXISTS partner_fulfillment_configs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  
  -- Para um modelo "Single Master Account", o token pode ser global e aqui guardamos apenas a chave do depósito,
  -- mas para flexibilidade, guardamos o token criptografado caso haja tokens por seller
  tiny_token_enc   BYTEA,  -- Criptografado com pgcrypto (mesmo pattern de oauth)
  tiny_deposit_id  TEXT,   -- ID do Depósito correspondente a esta org no Tiny ERP

  -- Flags e metadados
  is_active        BOOLEAN NOT NULL DEFAULT true,
  sync_orders      BOOLEAN NOT NULL DEFAULT true,
  sync_products    BOOLEAN NOT NULL DEFAULT true,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(organization_id)
);

COMMENT ON TABLE partner_fulfillment_configs IS
  'Configurações de integração com o galpão parceiro rodando Tiny ERP.';

-- RLS para configs
ALTER TABLE partner_fulfillment_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_members_view_tiny_configs" ON partner_fulfillment_configs
  FOR SELECT USING (
    organization_id IN (SELECT organization_id FROM org_members WHERE user_id = auth.uid())
  );

CREATE POLICY "org_members_manage_tiny_configs" ON partner_fulfillment_configs
  FOR ALL USING (
    organization_id IN (SELECT organization_id FROM org_members WHERE user_id = auth.uid() AND role IN ('owner', 'admin', 'manager'))
  );

CREATE POLICY "service_role_all_tiny_configs" ON partner_fulfillment_configs
  FOR ALL USING (auth.role() = 'service_role');

-- Trigger de updated_at
CREATE TRIGGER trg_partner_fulfillment_configs_updated_at
  BEFORE UPDATE ON partner_fulfillment_configs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- 2. Tabela de auditoria de sincronização (Tiny Sync Logs)
CREATE TABLE IF NOT EXISTS tiny_sync_logs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  
  sync_type        TEXT NOT NULL CHECK (sync_type IN ('order_push', 'product_push', 'stock_pull', 'shipping_pull')),
  entity_id        TEXT NOT NULL, -- ID do pedido ou produto local
  tiny_id          TEXT,          -- ID retornado pelo Tiny
  
  status           TEXT NOT NULL CHECK (status IN ('success', 'error', 'pending')),
  payload_sent     JSONB,
  response_body    JSONB,
  error_message    TEXT,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE tiny_sync_logs IS 'Auditoria de envios e retornos da API do Tiny ERP.';

ALTER TABLE tiny_sync_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_members_view_tiny_logs" ON tiny_sync_logs
  FOR SELECT USING (
    organization_id IN (SELECT organization_id FROM org_members WHERE user_id = auth.uid())
  );

CREATE POLICY "service_role_all_tiny_logs" ON tiny_sync_logs
  FOR ALL USING (auth.role() = 'service_role');


-- 3. Atualizar stock_locations para suportar 'partner_fulfillment'
ALTER TABLE stock_locations DROP CONSTRAINT IF EXISTS stock_locations_location_type_check;

ALTER TABLE stock_locations ADD CONSTRAINT stock_locations_location_type_check
  CHECK (location_type IN ('meli_facility', 'seller_warehouse', 'flex_origin', 'partner_fulfillment'));


-- 4. Atualizar a View vw_stock_by_origin
DROP VIEW IF EXISTS vw_stock_by_origin;

CREATE VIEW vw_stock_by_origin AS
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
  COALESCE(SUM(sl.quantity) FILTER (WHERE sl.location_type = 'partner_fulfillment'),0) AS qty_partner_fulfillment,

  -- Disponível (descontando reservas)
  COALESCE(SUM(sl.available) FILTER (WHERE sl.location_type = 'meli_facility'),  0) AS avail_ml_full,
  COALESCE(SUM(sl.available) FILTER (WHERE sl.location_type = 'flex_origin'),    0) AS avail_ml_flex,
  COALESCE(SUM(sl.available) FILTER (WHERE sl.location_type = 'seller_warehouse'),0) AS avail_proprio,
  COALESCE(SUM(sl.available) FILTER (WHERE sl.location_type = 'partner_fulfillment'),0) AS avail_partner_fulfillment,

  MAX(sl.last_synced_at) AS last_synced_at

FROM products p
LEFT JOIN stock_locations sl
  ON sl.product_id = p.id
  AND sl.organization_id = p.organization_id
GROUP BY p.id, p.organization_id, p.sku, p.name, p.min_stock, p.stock_alert, p.total_stock;

COMMENT ON VIEW vw_stock_by_origin IS
  'Estoque consolidado por produto com breakdown Full/Flex/Próprio/Partner Fulfillment.';
