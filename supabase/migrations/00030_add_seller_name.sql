-- ============================================================================
-- E-CONOMIA: Migration 00030 - Add seller_name column
-- A RPC save_marketplace_integration (00024) referencia seller_name,
-- mas a tabela original (00003) só tem seller_nickname.
-- ============================================================================

ALTER TABLE marketplace_integrations
  ADD COLUMN IF NOT EXISTS seller_name TEXT;

COMMENT ON COLUMN marketplace_integrations.seller_name IS 'Nome do vendedor no marketplace (preenchido via OAuth)';
