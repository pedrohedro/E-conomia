-- ============================================================================
-- E-CONOMIA: Migration 00002 - Tabelas Core (Organização, Perfis, Membros)
-- Multi-tenant: cada organização é isolada via RLS
-- ============================================================================

-- Organizações (tenant principal)
-- Cada e-commerce owner cria uma organização ao se cadastrar
CREATE TABLE organizations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,                                -- "Loja do Abner"
  slug        TEXT UNIQUE NOT NULL,                         -- "loja-do-abner" (para URLs)
  cnpj        TEXT,                                         -- CNPJ da empresa (opcional)
  tax_regime  TEXT DEFAULT 'simples_nacional',              -- Regime tributário
  tax_rate    NUMERIC(5,2) DEFAULT 6.00,                    -- Alíquota padrão (Simples 6%)
  settings    JSONB DEFAULT '{}'::jsonb,                    -- Configurações gerais (moeda, fuso, etc)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE organizations IS 'Organização/empresa - unidade de isolamento multi-tenant';
COMMENT ON COLUMN organizations.tax_regime IS 'Regime tributário: simples_nacional, lucro_presumido, lucro_real, mei';
COMMENT ON COLUMN organizations.settings IS 'JSON livre para configs: {currency, timezone, logo_url, etc}';

-- Perfis de usuário (extends auth.users)
-- Criado automaticamente via trigger quando um usuário se registra
CREATE TABLE profiles (
  id              UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name       TEXT,
  avatar_url      TEXT,
  phone           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE profiles IS 'Perfil público do usuário, estende auth.users';

-- Membros de uma organização (vínculo user <-> org)
-- Um usuário pode pertencer a várias organizações
CREATE TABLE org_members (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role            user_role NOT NULL DEFAULT 'viewer',
  invited_email   TEXT,                                     -- Email do convite (antes de aceitar)
  invited_at      TIMESTAMPTZ,
  accepted_at     TIMESTAMPTZ,
  is_active       BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(organization_id, user_id)
);

COMMENT ON TABLE org_members IS 'Vínculo entre usuários e organizações com papel definido';

CREATE INDEX idx_org_members_org ON org_members(organization_id);
CREATE INDEX idx_org_members_user ON org_members(user_id);
CREATE INDEX idx_org_members_active ON org_members(organization_id, is_active) WHERE is_active = true;

-- ============================================================================
-- Função auxiliar: retorna os IDs das organizações do usuário autenticado
-- Usada em todas as políticas RLS
-- ============================================================================
CREATE OR REPLACE FUNCTION get_user_org_ids()
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT organization_id
  FROM org_members
  WHERE user_id = auth.uid()
    AND is_active = true;
$$;

-- Função auxiliar: verifica se o usuário tem um papel mínimo numa org
CREATE OR REPLACE FUNCTION user_has_role(org_id UUID, min_role user_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM org_members
    WHERE organization_id = org_id
      AND user_id = auth.uid()
      AND is_active = true
      AND role <= min_role  -- enum ordering: owner < admin < manager < viewer
  );
$$;

-- ============================================================================
-- Trigger: criar perfil automaticamente ao registrar usuário
-- ============================================================================
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO profiles (id, full_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    NEW.raw_user_meta_data->>'avatar_url'
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION handle_new_user();

-- Trigger: updated_at automático
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_organizations_updated_at
  BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
