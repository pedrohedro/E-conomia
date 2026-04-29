-- ============================================================================
-- E-CONOMIA: Migration 00024 - Secure Tokens (pgcrypto)
-- Cria função RPC para salvar integrações criptografando tokens
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Esta função RPC salva a integração usando pgp_sym_encrypt para os tokens
-- A chave de criptografia será recuperada das configurações do banco,
-- mas usaremos uma chave de fallback ('economia-dev-key') se não definida.
-- Em produção, deve-se setar:
-- ALTER DATABASE postgres SET "app.settings.encryption_key" TO 'super_secreta';

CREATE OR REPLACE FUNCTION save_marketplace_integration(
  p_org_id UUID,
  p_marketplace TEXT,
  p_seller_id TEXT,
  p_seller_name TEXT,
  p_access_token TEXT,
  p_refresh_token TEXT,
  p_expires_in INT,
  p_config JSONB
) RETURNS void AS $$
DECLARE
  v_enc_key TEXT;
  v_expires_at TIMESTAMPTZ;
BEGIN
  -- Tenta pegar a chave do config, fallback para chave de dev
  v_enc_key := current_setting('app.settings.encryption_key', true);
  IF v_enc_key IS NULL OR v_enc_key = '' THEN
    v_enc_key := 'economia-dev-key-fallback';
  END IF;

  IF p_expires_in IS NOT NULL THEN
    v_expires_at := now() + make_interval(secs := p_expires_in);
  ELSE
    v_expires_at := NULL;
  END IF;

  INSERT INTO marketplace_integrations (
    organization_id,
    marketplace,
    status,
    seller_id,
    seller_name,
    seller_nickname,
    access_token,
    refresh_token,
    token_expires_at,
    config
  ) VALUES (
    p_org_id,
    p_marketplace::marketplace_type,
    'active',
    p_seller_id,
    p_seller_name,
    p_seller_name,
    CASE WHEN p_access_token IS NOT NULL THEN pgp_sym_encrypt(p_access_token, v_enc_key) ELSE NULL END,
    CASE WHEN p_refresh_token IS NOT NULL THEN pgp_sym_encrypt(p_refresh_token, v_enc_key) ELSE NULL END,
    v_expires_at,
    p_config
  )
  ON CONFLICT (organization_id, marketplace) DO UPDATE SET
    status = 'active',
    seller_id = EXCLUDED.seller_id,
    seller_name = EXCLUDED.seller_name,
    seller_nickname = EXCLUDED.seller_nickname,
    access_token = CASE WHEN EXCLUDED.access_token IS NOT NULL THEN EXCLUDED.access_token ELSE marketplace_integrations.access_token END,
    refresh_token = CASE WHEN EXCLUDED.refresh_token IS NOT NULL THEN EXCLUDED.refresh_token ELSE marketplace_integrations.refresh_token END,
    token_expires_at = EXCLUDED.token_expires_at,
    config = EXCLUDED.config,
    updated_at = now();

END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Função auxiliar para decriptar os tokens e usá-los com segurança no servidor
CREATE OR REPLACE FUNCTION get_decrypted_integration(p_id UUID)
RETURNS TABLE (
  id UUID,
  organization_id UUID,
  marketplace marketplace_type,
  seller_id TEXT,
  access_token TEXT,
  refresh_token TEXT,
  token_expires_at TIMESTAMPTZ,
  config JSONB
) AS $$
DECLARE
  v_enc_key TEXT;
BEGIN
  v_enc_key := current_setting('app.settings.encryption_key', true);
  IF v_enc_key IS NULL OR v_enc_key = '' THEN
    v_enc_key := 'economia-dev-key-fallback';
  END IF;

  RETURN QUERY
  SELECT 
    m.id,
    m.organization_id,
    m.marketplace,
    m.seller_id,
    CASE WHEN m.access_token IS NOT NULL THEN pgp_sym_decrypt(m.access_token::bytea, v_enc_key) ELSE NULL END,
    CASE WHEN m.refresh_token IS NOT NULL THEN pgp_sym_decrypt(m.refresh_token::bytea, v_enc_key) ELSE NULL END,
    m.token_expires_at,
    m.config
  FROM marketplace_integrations m
  WHERE m.id = p_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Função auxiliar para decriptar a lista de integrações para o cron job (refresh)
CREATE OR REPLACE FUNCTION get_decrypted_integration_list(
  p_status integration_status,
  p_marketplace marketplace_type,
  p_expires_before TIMESTAMPTZ
)
RETURNS TABLE (
  id UUID,
  organization_id UUID,
  marketplace marketplace_type,
  seller_id TEXT,
  seller_name TEXT,
  access_token TEXT,
  refresh_token TEXT,
  token_expires_at TIMESTAMPTZ,
  config JSONB
) AS $$
DECLARE
  v_enc_key TEXT;
BEGIN
  v_enc_key := current_setting('app.settings.encryption_key', true);
  IF v_enc_key IS NULL OR v_enc_key = '' THEN
    v_enc_key := 'economia-dev-key-fallback';
  END IF;

  RETURN QUERY
  SELECT 
    m.id,
    m.organization_id,
    m.marketplace,
    m.seller_id,
    m.seller_name,
    CASE WHEN m.access_token IS NOT NULL THEN pgp_sym_decrypt(m.access_token::bytea, v_enc_key) ELSE NULL END,
    CASE WHEN m.refresh_token IS NOT NULL THEN pgp_sym_decrypt(m.refresh_token::bytea, v_enc_key) ELSE NULL END,
    m.token_expires_at,
    m.config
  FROM marketplace_integrations m
  WHERE m.status = p_status
    AND m.marketplace = p_marketplace
    AND m.refresh_token IS NOT NULL
    AND (p_expires_before IS NULL OR m.token_expires_at < p_expires_before);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
