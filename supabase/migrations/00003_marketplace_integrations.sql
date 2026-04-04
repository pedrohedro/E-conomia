-- ============================================================================
-- E-CONOMIA: Migration 00003 - Integrações com Marketplaces
-- OAuth tokens, configurações por marketplace, webhooks
-- ============================================================================

-- Integrações com marketplaces (uma por marketplace por organização)
CREATE TABLE marketplace_integrations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  marketplace       marketplace_type NOT NULL,
  status            integration_status NOT NULL DEFAULT 'disconnected',

  -- Dados da conta no marketplace
  seller_id         TEXT,                  -- ID do vendedor no marketplace
  seller_nickname   TEXT,                  -- Nome/nick do vendedor
  seller_url        TEXT,                  -- URL da loja no marketplace

  -- OAuth tokens (criptografados via pgcrypto ou vault)
  access_token      TEXT,                  -- Token de acesso (considerar criptografar)
  refresh_token     TEXT,                  -- Token de refresh
  token_expires_at  TIMESTAMPTZ,           -- Quando o access_token expira
  oauth_scope       TEXT,                  -- Scopes concedidos

  -- Configurações específicas do marketplace
  config            JSONB DEFAULT '{}'::jsonb,
  -- Ex ML: {app_id, fee_full_percent: 20, fee_flex_percent: 15}
  -- Ex Amazon: {merchant_id, fba_fee_percent: 15, dba_fee_percent: 12}

  -- Webhook
  webhook_url       TEXT,                  -- URL do webhook configurada
  webhook_secret    TEXT,                  -- Secret para validar webhooks

  -- Sync control
  last_sync_at      TIMESTAMPTZ,           -- Última sincronização bem-sucedida
  last_sync_error   TEXT,                  -- Último erro de sync (null se OK)
  sync_cursor       TEXT,                  -- Cursor/offset para sync incremental

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(organization_id, marketplace)
);

COMMENT ON TABLE marketplace_integrations IS 'Conexões OAuth com cada marketplace por organização';
COMMENT ON COLUMN marketplace_integrations.config IS 'Configurações específicas: taxas, IDs, preferências de fulfillment';

CREATE INDEX idx_integrations_org ON marketplace_integrations(organization_id);
CREATE INDEX idx_integrations_status ON marketplace_integrations(status) WHERE status = 'active';
CREATE INDEX idx_integrations_token_expiry ON marketplace_integrations(token_expires_at)
  WHERE status = 'active';

-- Log de eventos de sync (para debug e auditoria)
CREATE TABLE sync_logs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id    UUID NOT NULL REFERENCES marketplace_integrations(id) ON DELETE CASCADE,
  organization_id   UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_type        TEXT NOT NULL,         -- 'orders_sync', 'stock_update', 'token_refresh'
  status            TEXT NOT NULL,         -- 'started', 'success', 'error'
  records_processed INT DEFAULT 0,
  error_message     TEXT,
  metadata          JSONB DEFAULT '{}'::jsonb,
  started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at       TIMESTAMPTZ
);

CREATE INDEX idx_sync_logs_integration ON sync_logs(integration_id, started_at DESC);
CREATE INDEX idx_sync_logs_org ON sync_logs(organization_id, started_at DESC);

CREATE TRIGGER trg_marketplace_integrations_updated_at
  BEFORE UPDATE ON marketplace_integrations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
