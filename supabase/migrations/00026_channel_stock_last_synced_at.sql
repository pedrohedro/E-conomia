-- ============================================================================
-- E-CONOMIA: Migration 00026 - Channel Stock last_synced_at (ECOM-77)
-- Adiciona last_synced_at na tabela channel_stock para permitir sync incremental
-- ============================================================================

ALTER TABLE channel_stock ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_channel_stock_last_synced ON channel_stock(last_synced_at);
