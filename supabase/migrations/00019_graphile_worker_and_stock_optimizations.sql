-- ============================================================================
-- E-CONOMIA: Migration 00019 - Graphile Worker & Stock Optimizations
-- Implementa atomicidade para reversas e índices para consultas rápidas
-- ============================================================================

-- 1. Index para queries de movimentações por org/produto ordenadas por data
-- (NOW() não é IMMUTABLE, então usamos índice completo em vez de partial.)
CREATE INDEX IF NOT EXISTS idx_stock_movements_recent
  ON stock_movements (organization_id, product_id, created_at DESC);

-- 2. Função RPC blindada contra chamadas concorrentes (ACID)
-- Garante que duas vendas em mesma fração de segundo não negativarão o inventário
CREATE OR REPLACE FUNCTION reserve_channel_stock(
  p_org_id UUID,
  p_product_id UUID,
  p_channel marketplace_type,
  p_qty INT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_available INT;
BEGIN
  -- Locka a linha específica até o fim da transação para impedir "Phantom Views"
  SELECT available INTO v_current_available
  FROM channel_stock
  WHERE organization_id = p_org_id 
    AND product_id = p_product_id 
    AND channel = p_channel
  FOR UPDATE;

  -- Falha cedo se registro não bate
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  -- Impede Over-selling se requerido for além do dispnível
  IF v_current_available < p_qty THEN
    RETURN FALSE;
  END IF;

  -- Transaciona a reserva
  UPDATE channel_stock
  SET reserved = reserved + p_qty,
      updated_at = NOW()
  WHERE organization_id = p_org_id 
    AND product_id = p_product_id 
    AND channel = p_channel;

  RETURN TRUE;
END;
$$;
