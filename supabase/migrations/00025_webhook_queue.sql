-- ============================================================================
-- E-CONOMIA: Migration 00025 - Webhook Queue (ECOM-76)
-- Tabela para enfileiramento e deduplicação de webhooks do Mercado Livre
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE TABLE webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  marketplace marketplace_type NOT NULL,
  topic TEXT NOT NULL,
  resource TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending, processing, success, error
  error_message TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  
  -- Para deduplicação, usamos uma combinação do resource com o timestamp 'sent'
  -- Se o ML reenviar o exato mesmo evento, ele falhará no constraint
  unique_hash TEXT UNIQUE
);

COMMENT ON TABLE webhook_events IS 'Fila de eventos de webhook para processamento assíncrono';

CREATE INDEX idx_webhook_events_pending ON webhook_events(status) WHERE status = 'pending';
CREATE INDEX idx_webhook_events_resource ON webhook_events(resource);

-- Função para invocar a edge function de processamento (process-webhook) async
CREATE OR REPLACE FUNCTION trigger_process_webhook() RETURNS TRIGGER AS $$
DECLARE
  v_url TEXT;
  v_key TEXT;
  v_req_id BIGINT;
BEGIN
  v_url := current_setting('app.settings.edge_function_url', true);
  v_key := current_setting('app.settings.service_role_key', true);
  
  IF v_url IS NOT NULL AND v_url != '' THEN
    SELECT net.http_post(
      url := v_url || '/webhook-handler',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_key
      ),
      body := jsonb_build_object('event_id', NEW.id, 'is_internal_trigger', true)
    ) INTO v_req_id;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_webhook_event_insert
  AFTER INSERT ON webhook_events
  FOR EACH ROW EXECUTE FUNCTION trigger_process_webhook();
