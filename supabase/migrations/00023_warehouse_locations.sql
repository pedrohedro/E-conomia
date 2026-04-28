-- 00023_warehouse_locations.sql
-- ECOM-83 | Endereçamento de Armazém — Localizações Físicas do Estoque Próprio

CREATE TABLE IF NOT EXISTS public.warehouse_locations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  code            TEXT NOT NULL,        -- ex: "A-01-02" (corredor-prateleira-posição)
  description     TEXT,                 -- ex: "Corredor A, Prateleira 1, Posição 2"
  aisle           TEXT,                 -- Corredor / Setor
  shelf           TEXT,                 -- Prateleira
  position        TEXT,                 -- Posição na prateleira
  zone            TEXT DEFAULT 'geral', -- 'picking', 'storage', 'expedição', 'quarentena'
  capacity        INT DEFAULT 0,        -- Capacidade máxima (unidades)
  active          BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id, code)
);

-- Associação produto → localização no armazém
CREATE TABLE IF NOT EXISTS public.product_locations (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  product_id            UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  warehouse_location_id UUID NOT NULL REFERENCES public.warehouse_locations(id) ON DELETE CASCADE,
  quantity              INT NOT NULL DEFAULT 0,
  is_primary            BOOLEAN DEFAULT TRUE,  -- Localização principal do produto
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(product_id, warehouse_location_id)
);

-- RLS
ALTER TABLE public.warehouse_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_locations   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "warehouse_locations: own org" ON public.warehouse_locations;
CREATE POLICY "warehouse_locations: own org" ON public.warehouse_locations
  USING (organization_id IN (SELECT organization_id FROM public.org_members WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "warehouse_locations: insert" ON public.warehouse_locations;
CREATE POLICY "warehouse_locations: insert" ON public.warehouse_locations FOR INSERT
  WITH CHECK (organization_id IN (SELECT organization_id FROM public.org_members WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "warehouse_locations: update" ON public.warehouse_locations;
CREATE POLICY "warehouse_locations: update" ON public.warehouse_locations FOR UPDATE
  USING (organization_id IN (SELECT organization_id FROM public.org_members WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "warehouse_locations: delete" ON public.warehouse_locations;
CREATE POLICY "warehouse_locations: delete" ON public.warehouse_locations FOR DELETE
  USING (organization_id IN (SELECT organization_id FROM public.org_members WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "warehouse_locations: service_role" ON public.warehouse_locations;
CREATE POLICY "warehouse_locations: service_role" ON public.warehouse_locations
  USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "product_locations: own org" ON public.product_locations;
CREATE POLICY "product_locations: own org" ON public.product_locations
  USING (organization_id IN (SELECT organization_id FROM public.org_members WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "product_locations: insert" ON public.product_locations;
CREATE POLICY "product_locations: insert" ON public.product_locations FOR INSERT
  WITH CHECK (organization_id IN (SELECT organization_id FROM public.org_members WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "product_locations: update" ON public.product_locations;
CREATE POLICY "product_locations: update" ON public.product_locations FOR UPDATE
  USING (organization_id IN (SELECT organization_id FROM public.org_members WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "product_locations: delete" ON public.product_locations;
CREATE POLICY "product_locations: delete" ON public.product_locations FOR DELETE
  USING (organization_id IN (SELECT organization_id FROM public.org_members WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "product_locations: service_role" ON public.product_locations;
CREATE POLICY "product_locations: service_role" ON public.product_locations
  USING (auth.role() = 'service_role');

-- Índices
CREATE INDEX IF NOT EXISTS idx_wl_org_code ON public.warehouse_locations(organization_id, code);
CREATE INDEX IF NOT EXISTS idx_pl_product  ON public.product_locations(product_id);
CREATE INDEX IF NOT EXISTS idx_pl_location ON public.product_locations(warehouse_location_id);

-- Trigger updated_at
DROP TRIGGER IF EXISTS trg_warehouse_locations_updated_at ON public.warehouse_locations;
CREATE TRIGGER trg_warehouse_locations_updated_at
  BEFORE UPDATE ON public.warehouse_locations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
