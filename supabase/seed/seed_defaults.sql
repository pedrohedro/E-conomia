-- ============================================================================
-- E-CONOMIA: Seed - Dados padrão para novas organizações
-- Executar via Edge Function no momento do onboarding
-- ============================================================================

-- Função para criar categorias padrão de despesas ao criar uma organização
CREATE OR REPLACE FUNCTION seed_org_defaults(org_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO expense_categories (organization_id, name, icon, color, is_default) VALUES
    (org_id, 'Fornecedores',       'truck',       '#F59E0B', true),
    (org_id, 'Aluguel',            'building',    '#EF4444', true),
    (org_id, 'Pró-Labore',         'users',       '#3B82F6', true),
    (org_id, 'Impostos (DAS)',     'receipt',      '#F43F5E', true),
    (org_id, 'Publicidade/Ads',    'megaphone',   '#8B5CF6', true),
    (org_id, 'Embalagens',         'box',         '#06B6D4', true),
    (org_id, 'Frete',              'truck',       '#10B981', true),
    (org_id, 'Funcionários',       'users',       '#EC4899', true),
    (org_id, 'Software/SaaS',      'monitor',     '#6366F1', true),
    (org_id, 'Outros',             'file-text',   '#6B7280', true);
END;
$$;

-- Trigger: ao criar organização, popular com defaults
CREATE OR REPLACE FUNCTION on_org_created()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM seed_org_defaults(NEW.id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_org_created_seed
  AFTER INSERT ON organizations
  FOR EACH ROW
  EXECUTE FUNCTION on_org_created();
