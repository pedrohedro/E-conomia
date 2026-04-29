-- ============================================================================
-- E-CONOMIA: Migration 00027 - Trigger Push Stock to ML (ECOM-79)
-- Ao alterar estoque no ERP (channel_stock), envia para o Mercado Livre via pg_net.
-- ============================================================================

CREATE OR REPLACE FUNCTION fn_trigger_push_stock_ml()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_edge_url TEXT;
  v_anon_key TEXT;
  v_payload JSONB;
  v_req_id BIGINT;
BEGIN
  -- Só dispara se a quantidade mudou
  IF (TG_OP = 'UPDATE' AND OLD.quantity = NEW.quantity) THEN
    RETURN NEW;
  END IF;

  -- Só para canais Próprio/Flex do Mercado Livre (Full não pode ser alterado via API de /items)
  IF (NEW.channel NOT IN ('ml_flex', 'seller_warehouse')) THEN
    RETURN NEW;
  END IF;

  -- Verifica se tem o sku do canal
  IF (NEW.channel_sku IS NULL) THEN
    RETURN NEW;
  END IF;

  -- Obtém as configurações da tabela app_settings
  SELECT value INTO v_edge_url FROM app_settings WHERE key = 'edge_function_url';
  SELECT value INTO v_anon_key FROM app_settings WHERE key = 'anon_key';

  IF v_edge_url IS NULL OR v_anon_key IS NULL THEN
    RETURN NEW;
  END IF;

  v_payload := jsonb_build_object(
    'organization_id', NEW.organization_id,
    'product_id', NEW.product_id,
    'channel_sku', NEW.channel_sku,
    'quantity', NEW.quantity
  );

  -- Realiza o request POST assíncrono para a Edge Function via pg_net
  SELECT net.http_post(
    url := v_edge_url || '/push-stock-to-ml',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_anon_key
    ),
    body := v_payload
  ) INTO v_req_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_push_stock_ml ON channel_stock;
CREATE TRIGGER trg_push_stock_ml
  AFTER INSERT OR UPDATE ON channel_stock
  FOR EACH ROW
  EXECUTE FUNCTION fn_trigger_push_stock_ml();
