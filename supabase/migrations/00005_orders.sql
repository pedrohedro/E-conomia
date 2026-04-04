-- ============================================================================
-- E-CONOMIA: Migration 00005 - Pedidos Multi-Marketplace
-- Pedidos importados dos marketplaces com dados financeiros detalhados
-- ============================================================================

-- Clientes (compradores dos marketplaces)
CREATE TABLE customers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  marketplace     marketplace_type,
  marketplace_buyer_id TEXT,              -- ID do comprador no marketplace
  name            TEXT NOT NULL,
  email           TEXT,
  phone           TEXT,
  document        TEXT,                   -- CPF/CNPJ
  city            TEXT,
  state           TEXT,                   -- UF: "SP", "MG", "RJ"
  zip_code        TEXT,
  address         JSONB,                  -- Endereço completo
  total_orders    INT DEFAULT 0,
  total_spent     NUMERIC(12,2) DEFAULT 0,
  first_order_at  TIMESTAMPTZ,
  last_order_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_customers_org ON customers(organization_id);
CREATE INDEX idx_customers_marketplace ON customers(organization_id, marketplace);
CREATE INDEX idx_customers_state ON customers(organization_id, state);
CREATE UNIQUE INDEX idx_customers_marketplace_buyer ON customers(organization_id, marketplace, marketplace_buyer_id)
  WHERE marketplace_buyer_id IS NOT NULL;

-- Pedidos
CREATE TABLE orders (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- Identificação
  order_number        TEXT NOT NULL,        -- "#ML-100203491" ou "#AMZ-882-99182"
  marketplace         marketplace_type NOT NULL,
  marketplace_order_id TEXT,                -- ID original no marketplace
  integration_id      UUID REFERENCES marketplace_integrations(id) ON DELETE SET NULL,

  -- Cliente
  customer_id         UUID REFERENCES customers(id) ON DELETE SET NULL,

  -- Status
  status              order_status NOT NULL DEFAULT 'pending',
  fulfillment         fulfillment_type NOT NULL,

  -- Financeiro
  gross_amount        NUMERIC(12,2) NOT NULL DEFAULT 0,    -- Valor bruto do pedido
  marketplace_fee_pct NUMERIC(5,2) DEFAULT 0,              -- % da taxa do marketplace
  marketplace_fee_amt NUMERIC(12,2) DEFAULT 0,             -- R$ da taxa do marketplace
  shipping_cost       NUMERIC(12,2) DEFAULT 0,             -- Custo de frete
  discount_amount     NUMERIC(12,2) DEFAULT 0,             -- Descontos aplicados
  net_amount          NUMERIC(12,2) GENERATED ALWAYS AS (
    gross_amount - marketplace_fee_amt - shipping_cost - discount_amount
  ) STORED,

  -- Notas Fiscais
  nfe_status          nfe_status DEFAULT 'pending',
  nfe_number          TEXT,                                  -- Número da NFe
  nfe_key             TEXT,                                  -- Chave da NFe (44 dígitos)
  nfe_file_path       TEXT,                                  -- Path no Storage (XML/PDF)

  -- Logística
  shipping_label_status  shipping_label_status DEFAULT 'pending',
  tracking_code          TEXT,                               -- Código de rastreio
  carrier                TEXT,                               -- Transportadora
  estimated_delivery_at  TIMESTAMPTZ,
  shipped_at             TIMESTAMPTZ,
  delivered_at           TIMESTAMPTZ,

  -- Dados brutos do marketplace (JSON completo para auditoria)
  raw_data            JSONB,

  -- Datas
  marketplace_created_at TIMESTAMPTZ,       -- Data do pedido no marketplace
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(organization_id, marketplace, marketplace_order_id)
);

COMMENT ON TABLE orders IS 'Pedidos importados de todos os marketplaces';
COMMENT ON COLUMN orders.order_number IS 'Número legível: #ML-XXXXX, #AMZ-XXXXX';
COMMENT ON COLUMN orders.net_amount IS 'Valor líquido: bruto - taxas - frete - descontos';
COMMENT ON COLUMN orders.raw_data IS 'JSON original do marketplace para auditoria e debug';

CREATE INDEX idx_orders_org ON orders(organization_id);
CREATE INDEX idx_orders_marketplace ON orders(organization_id, marketplace);
CREATE INDEX idx_orders_status ON orders(organization_id, status);
CREATE INDEX idx_orders_date ON orders(organization_id, marketplace_created_at DESC);
CREATE INDEX idx_orders_nfe ON orders(organization_id, nfe_status)
  WHERE nfe_status = 'pending';
CREATE INDEX idx_orders_customer ON orders(customer_id);
CREATE INDEX idx_orders_number ON orders(organization_id, order_number);

-- Itens do pedido
CREATE TABLE order_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  product_id      UUID REFERENCES products(id) ON DELETE SET NULL,
  sku             TEXT,                          -- SKU no momento da venda (snapshot)
  product_name    TEXT NOT NULL,                 -- Nome no momento da venda
  quantity        INT NOT NULL DEFAULT 1,
  unit_price      NUMERIC(12,2) NOT NULL,        -- Preço unitário de venda
  total_price     NUMERIC(12,2) GENERATED ALWAYS AS (quantity * unit_price) STORED,
  cost_price      NUMERIC(12,2) DEFAULT 0,       -- Custo unitário no momento (para margem)
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_order_items_order ON order_items(order_id);
CREATE INDEX idx_order_items_product ON order_items(product_id);
CREATE INDEX idx_order_items_org ON order_items(organization_id);

-- ============================================================================
-- Trigger: Atualizar estatísticas do cliente quando um pedido é criado/atualizado
-- ============================================================================
CREATE OR REPLACE FUNCTION update_customer_stats()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.customer_id IS NOT NULL AND NEW.status NOT IN ('cancelled', 'returned') THEN
    UPDATE customers SET
      total_orders = (
        SELECT COUNT(*) FROM orders
        WHERE customer_id = NEW.customer_id
          AND status NOT IN ('cancelled', 'returned')
      ),
      total_spent = (
        SELECT COALESCE(SUM(gross_amount), 0) FROM orders
        WHERE customer_id = NEW.customer_id
          AND status NOT IN ('cancelled', 'returned')
      ),
      last_order_at = (
        SELECT MAX(marketplace_created_at) FROM orders
        WHERE customer_id = NEW.customer_id
      ),
      first_order_at = COALESCE(
        (SELECT MIN(marketplace_created_at) FROM orders WHERE customer_id = NEW.customer_id),
        now()
      ),
      updated_at = now()
    WHERE id = NEW.customer_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_orders_update_customer
  AFTER INSERT OR UPDATE OF status ON orders
  FOR EACH ROW
  EXECUTE FUNCTION update_customer_stats();

CREATE TRIGGER trg_orders_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_customers_updated_at
  BEFORE UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
