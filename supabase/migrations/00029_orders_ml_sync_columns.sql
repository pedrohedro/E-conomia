-- ============================================================================
-- E-CONOMIA: Migration 00029 - Correção de Colunas Sync Pedidos (ECOM-87)
-- Adiciona colunas jsonb de payload do Mercado Livre
-- ============================================================================

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS buyer_data JSONB,
  ADD COLUMN IF NOT EXISTS shipping_data JSONB;

-- Note: shipping_id was already present in migration 00005? No it wasn't.
-- Let's add it too.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS shipping_id TEXT;
