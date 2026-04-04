-- ============================================================================
-- E-CONOMIA: Migration 00004 - Produtos, Fornecedores e Inventário Multi-Canal
-- Estoque distribuído por canal de venda com alertas automáticos
-- ============================================================================

-- Fornecedores
CREATE TABLE suppliers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,              -- "Dux Nutrition"
  contact_name    TEXT,
  email           TEXT,
  phone           TEXT,
  cnpj            TEXT,
  address         JSONB,                      -- {street, city, state, zip}
  payment_terms   TEXT,                       -- "30 dias", "PIX à vista"
  notes           TEXT,
  is_active       BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_suppliers_org ON suppliers(organization_id);

-- Produtos (catálogo mestre)
CREATE TABLE products (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sku             TEXT NOT NULL,              -- SKU interno: "DUX-WPC-900"
  name            TEXT NOT NULL,              -- "Whey Protein Concentrado 900g"
  description     TEXT,
  supplier_id     UUID REFERENCES suppliers(id) ON DELETE SET NULL,

  -- Preços
  cost_price      NUMERIC(12,2) NOT NULL DEFAULT 0,     -- Preço de custo (fornecedor)
  sale_price      NUMERIC(12,2) NOT NULL DEFAULT 0,     -- Preço de venda sugerido
  margin_percent  NUMERIC(5,2) GENERATED ALWAYS AS (
    CASE WHEN sale_price > 0
      THEN ROUND(((sale_price - cost_price) / sale_price) * 100, 2)
      ELSE 0
    END
  ) STORED,

  -- Estoque consolidado (soma de todos os canais)
  total_stock     INT NOT NULL DEFAULT 0,
  min_stock       INT NOT NULL DEFAULT 10,     -- Estoque mínimo para alerta
  stock_alert     stock_alert_level NOT NULL DEFAULT 'normal',

  -- Metadados
  weight_grams    INT,
  dimensions      JSONB,                       -- {length_cm, width_cm, height_cm}
  barcode         TEXT,                        -- EAN/GTIN
  ncm             TEXT,                        -- NCM para notas fiscais
  image_url       TEXT,
  category        TEXT,
  tags            TEXT[],

  is_active       BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(organization_id, sku)
);

COMMENT ON TABLE products IS 'Catálogo mestre de produtos - SKU único por organização';
COMMENT ON COLUMN products.total_stock IS 'Soma de channel_stock. Atualizado via trigger.';
COMMENT ON COLUMN products.margin_percent IS 'Margem calculada: (venda - custo) / venda * 100';

CREATE INDEX idx_products_org ON products(organization_id);
CREATE INDEX idx_products_sku ON products(organization_id, sku);
CREATE INDEX idx_products_supplier ON products(supplier_id);
CREATE INDEX idx_products_alert ON products(organization_id, stock_alert)
  WHERE stock_alert != 'normal';
CREATE INDEX idx_products_search ON products USING gin(
  to_tsvector('portuguese', name || ' ' || COALESCE(sku, '') || ' ' || COALESCE(category, ''))
);

-- Estoque por canal (distribuição multi-marketplace)
-- Cada linha = quantidade de um produto em um canal específico
CREATE TABLE channel_stock (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  product_id      UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  channel         fulfillment_type NOT NULL,       -- ml_full, amazon_fba, etc.
  quantity        INT NOT NULL DEFAULT 0,
  reserved        INT NOT NULL DEFAULT 0,          -- Reservado por pedidos pendentes
  available       INT GENERATED ALWAYS AS (quantity - reserved) STORED,

  -- SKU do produto neste canal específico (pode diferir do SKU master)
  channel_sku     TEXT,                            -- "MLB-CRE-300" no ML, "B085HQW3PQ" na Amazon
  channel_url     TEXT,                            -- URL do anúncio

  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(product_id, channel)
);

COMMENT ON TABLE channel_stock IS 'Distribuição de estoque por canal de venda/fulfillment';
COMMENT ON COLUMN channel_stock.reserved IS 'Unidades reservadas por pedidos aprovados mas não enviados';

CREATE INDEX idx_channel_stock_product ON channel_stock(product_id);
CREATE INDEX idx_channel_stock_org ON channel_stock(organization_id);
CREATE INDEX idx_channel_stock_channel ON channel_stock(organization_id, channel);

-- Movimentações de estoque (log de entrada/saída)
CREATE TABLE stock_movements (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  product_id      UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  channel         fulfillment_type,
  movement_type   TEXT NOT NULL,            -- 'purchase', 'sale', 'transfer', 'adjustment', 'return'
  quantity        INT NOT NULL,             -- Positivo = entrada, negativo = saída
  reference_id    UUID,                     -- ID do pedido, compra ou transferência
  notes           TEXT,
  created_by      UUID REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_stock_movements_product ON stock_movements(product_id, created_at DESC);
CREATE INDEX idx_stock_movements_org ON stock_movements(organization_id, created_at DESC);

-- ============================================================================
-- Triggers: Recalcular estoque total e nível de alerta
-- ============================================================================

-- Recalcula o total_stock do produto baseado na soma dos channel_stock
CREATE OR REPLACE FUNCTION recalculate_product_stock()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product_id UUID;
  v_total INT;
  v_min INT;
  v_alert stock_alert_level;
BEGIN
  v_product_id := COALESCE(NEW.product_id, OLD.product_id);

  SELECT COALESCE(SUM(quantity), 0) INTO v_total
  FROM channel_stock
  WHERE product_id = v_product_id;

  SELECT min_stock INTO v_min
  FROM products
  WHERE id = v_product_id;

  IF v_total = 0 THEN
    v_alert := 'out_of_stock';
  ELSIF v_total <= (v_min * 0.5) THEN
    v_alert := 'critical';
  ELSIF v_total <= v_min THEN
    v_alert := 'low';
  ELSE
    v_alert := 'normal';
  END IF;

  UPDATE products
  SET total_stock = v_total,
      stock_alert = v_alert,
      updated_at = now()
  WHERE id = v_product_id;

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_channel_stock_recalculate
  AFTER INSERT OR UPDATE OR DELETE ON channel_stock
  FOR EACH ROW
  EXECUTE FUNCTION recalculate_product_stock();

CREATE TRIGGER trg_suppliers_updated_at
  BEFORE UPDATE ON suppliers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_products_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_channel_stock_updated_at
  BEFORE UPDATE ON channel_stock
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
