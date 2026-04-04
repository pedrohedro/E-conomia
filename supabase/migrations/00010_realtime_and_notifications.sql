-- ============================================================================
-- E-CONOMIA: Migration 00010 - Realtime e Notificações
-- Configuração de publicações Realtime e tabela de notificações
-- ============================================================================

-- Notificações in-app
CREATE TABLE notifications (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         UUID REFERENCES auth.users(id) ON DELETE CASCADE,  -- NULL = todos da org
  title           TEXT NOT NULL,
  body            TEXT,
  type            TEXT NOT NULL,           -- 'stock_alert', 'order_new', 'payment_due', 'sync_error'
  severity        TEXT DEFAULT 'info',     -- 'info', 'warning', 'error', 'success'
  reference_type  TEXT,                    -- 'product', 'order', 'expense', 'integration'
  reference_id    UUID,
  is_read         BOOLEAN DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notifications_user ON notifications(user_id, is_read, created_at DESC);
CREATE INDEX idx_notifications_org ON notifications(organization_id, created_at DESC);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY notifications_select ON notifications
  FOR SELECT USING (
    organization_id IN (SELECT get_user_org_ids())
    AND (user_id IS NULL OR user_id = auth.uid())
  );

CREATE POLICY notifications_update ON notifications
  FOR UPDATE USING (
    user_id = auth.uid()
    OR (user_id IS NULL AND organization_id IN (SELECT get_user_org_ids()))
  );

-- ============================================================================
-- Habilitar Realtime nas tabelas que precisam de updates ao vivo
-- ============================================================================

-- O Supabase Realtime precisa que as tabelas estejam na publicação 'supabase_realtime'
-- Estas são as tabelas que o frontend irá "escutar":

ALTER PUBLICATION supabase_realtime ADD TABLE orders;            -- Feed de vendas ao vivo
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;     -- Alertas em tempo real
ALTER PUBLICATION supabase_realtime ADD TABLE channel_stock;     -- Mudanças de estoque
ALTER PUBLICATION supabase_realtime ADD TABLE cash_flow_entries; -- Movimentações financeiras

-- ============================================================================
-- Trigger: Criar notificação automática quando estoque fica crítico
-- ============================================================================
CREATE OR REPLACE FUNCTION notify_stock_alert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.stock_alert IN ('critical', 'out_of_stock')
     AND (OLD.stock_alert IS NULL OR OLD.stock_alert NOT IN ('critical', 'out_of_stock'))
  THEN
    INSERT INTO notifications (
      organization_id, title, body, type, severity, reference_type, reference_id
    ) VALUES (
      NEW.organization_id,
      CASE NEW.stock_alert
        WHEN 'critical' THEN 'Estoque Crítico: ' || NEW.name
        WHEN 'out_of_stock' THEN 'SEM ESTOQUE: ' || NEW.name
      END,
      'SKU ' || NEW.sku || ' está com apenas ' || NEW.total_stock || ' unidades.',
      'stock_alert',
      CASE NEW.stock_alert
        WHEN 'critical' THEN 'warning'
        WHEN 'out_of_stock' THEN 'error'
      END,
      'product',
      NEW.id
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_product_stock_alert
  AFTER UPDATE OF stock_alert ON products
  FOR EACH ROW
  EXECUTE FUNCTION notify_stock_alert();

-- ============================================================================
-- Trigger: Notificar novo pedido (para o feed ao vivo)
-- ============================================================================
CREATE OR REPLACE FUNCTION notify_new_order()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'approved' AND (OLD IS NULL OR OLD.status = 'pending') THEN
    INSERT INTO notifications (
      organization_id, title, body, type, severity, reference_type, reference_id
    ) VALUES (
      NEW.organization_id,
      'Nova Venda ' || NEW.order_number,
      'Pedido de R$ ' || TO_CHAR(NEW.gross_amount, 'FM999G999D00') || ' via ' || NEW.marketplace,
      'order_new',
      'success',
      'order',
      NEW.id
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_new_order_notification
  AFTER INSERT OR UPDATE OF status ON orders
  FOR EACH ROW
  EXECUTE FUNCTION notify_new_order();
