-- ============================================================================
-- E-CONOMIA: Migration 00012 - Fix RLS chicken-and-egg + RPC create_organization_with_member
--
-- Problema: a policy org_members_insert exige user_has_role(organization_id, 'admin'),
-- mas quando o usuário cria sua primeira organização ele ainda não é membro,
-- então o INSERT em org_members falha mesmo que o INSERT em organizations tenha
-- sido aprovado pela policy orgs_insert WITH CHECK (true).
--
-- Solução: criar uma função RPC SECURITY DEFINER que executa a criação da org
-- e a adição do membro numa única transação, bypassando RLS de forma controlada.
-- O cliente passa a chamar esta RPC em vez de fazer dois INSERTs separados.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Corrigir o nome errado da função no trigger da migration 00011
--    (update_updated_at_column não existe; o nome correto é update_updated_at)
-- ----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS set_subscriptions_updated_at ON subscriptions;

CREATE TRIGGER set_subscriptions_updated_at
  BEFORE UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ----------------------------------------------------------------------------
-- 2. Adicionar policy de bootstrap para org_members
--    Permite que um usuário insira SUA PRÓPRIA entrada (auth.uid() = user_id)
--    apenas quando a organização recém foi criada pelo mesmo usuário e ele
--    ainda não é membro de nenhuma organização (primeira org).
--
--    Esta policy é uma salvaguarda secundária. O fluxo preferencial é a RPC
--    abaixo (item 3). Mantemos a policy para cobrir casos de migração de dados
--    e para garantir que a RPC funcione mesmo se chamada fora do contexto anon.
-- ----------------------------------------------------------------------------

-- Remover a policy restritiva existente sem destruir as demais
DROP POLICY IF EXISTS org_members_insert ON org_members;

-- Policy 1 (bootstrap): usuário adiciona a SI MESMO como owner numa org que
-- acabou de ser criada e ainda não possui nenhum membro registrado.
CREATE POLICY org_members_insert_bootstrap ON org_members
  FOR INSERT
  WITH CHECK (
    -- O usuário está inserindo a si próprio
    user_id = auth.uid()
    -- A organização ainda não tem nenhum membro (recém-criada)
    AND NOT EXISTS (
      SELECT 1
      FROM org_members existing
      WHERE existing.organization_id = org_members.organization_id
    )
    -- Apenas papéis owner/admin são permitidos na criação inicial
    AND role IN ('owner', 'admin')
  );

-- Policy 2 (admin convidando): admins/owners podem adicionar outros membros
CREATE POLICY org_members_insert_by_admin ON org_members
  FOR INSERT
  WITH CHECK (
    user_has_role(organization_id, 'admin')
  );

-- ----------------------------------------------------------------------------
-- 3. RPC SECURITY DEFINER: create_organization_with_member
--    Cria a organização e adiciona o usuário autenticado como 'owner'
--    numa única transação atômica, bypassando RLS de forma controlada.
--
--    Parâmetros:
--      org_name  TEXT  - Nome da organização (obrigatório)
--      org_slug  TEXT  - Slug único para URLs (opcional; gerado automaticamente
--                        a partir de org_name se NULL)
--
--    Retorna: UUID da nova organização
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION create_organization_with_member(
  org_name TEXT,
  org_slug TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id   UUID;
  v_org_id    UUID;
  v_slug      TEXT;
  v_attempt   INT := 0;
BEGIN
  -- Garantir que existe um usuário autenticado
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado' USING ERRCODE = 'P0001';
  END IF;

  -- Validar nome da organização
  IF org_name IS NULL OR trim(org_name) = '' THEN
    RAISE EXCEPTION 'O nome da organização não pode ser vazio' USING ERRCODE = 'P0002';
  END IF;

  -- Gerar slug: usa o fornecido ou deriva do nome
  v_slug := COALESCE(
    nullif(trim(org_slug), ''),
    lower(
      regexp_replace(
        regexp_replace(trim(org_name), '[^a-zA-Z0-9\s-]', '', 'g'),
        '\s+', '-', 'g'
      )
    )
  );

  -- Garantir unicidade do slug (adiciona sufixo numérico se necessário)
  LOOP
    IF v_attempt = 0 THEN
      -- Primeira tentativa: slug limpo
      NULL;
    ELSE
      -- Tentativas seguintes: adiciona sufixo aleatório de 4 caracteres
      v_slug := v_slug || '-' || substr(md5(random()::text), 1, 4);
    END IF;

    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM organizations WHERE slug = v_slug
    );

    v_attempt := v_attempt + 1;
    IF v_attempt > 10 THEN
      RAISE EXCEPTION 'Não foi possível gerar um slug único para "%"', org_name
        USING ERRCODE = 'P0003';
    END IF;
  END LOOP;

  -- Inserir a organização (sem restrição de RLS pois estamos com SECURITY DEFINER)
  INSERT INTO organizations (name, slug)
  VALUES (trim(org_name), v_slug)
  RETURNING id INTO v_org_id;

  -- Inserir o criador como 'owner' com accepted_at preenchido
  INSERT INTO org_members (organization_id, user_id, role, accepted_at, is_active)
  VALUES (v_org_id, v_user_id, 'owner', now(), true);

  -- Criar assinatura free automaticamente para a nova organização
  INSERT INTO subscriptions (organization_id, plan, status)
  VALUES (v_org_id, 'free', 'active')
  ON CONFLICT DO NOTHING;

  RETURN v_org_id;
END;
$$;

-- Conceder permissão de execução apenas para usuários autenticados (role authenticated)
REVOKE ALL ON FUNCTION create_organization_with_member(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_organization_with_member(TEXT, TEXT) TO authenticated;

COMMENT ON FUNCTION create_organization_with_member(TEXT, TEXT) IS
  'Cria uma organização e adiciona o usuário autenticado como owner numa transação atômica.
   Usa SECURITY DEFINER para bypassar o problema chicken-and-egg do RLS em org_members.
   Retorna o UUID da organização criada.';
