-- ============================================================================
-- E-CONOMIA: Migration 00028 - Integração Multi-ERP (Tiny & Omie)
-- Suporte para parceiros de fulfillment 3PL via ERPs externos
-- ============================================================================

-- 1. Adicionar novos tipos de integração (ERPs)
-- Nota: PostgreSQL não permite ALTER TYPE ADD VALUE dentro de transações em algumas versões,
-- mas no Supabase/Postgres 14+ funciona se for feito separadamente.
ALTER TYPE marketplace_type ADD VALUE 'erp_olist_hub';
ALTER TYPE marketplace_type ADD VALUE 'erp_omie';

-- 2. Adicionar novo tipo de fulfillment
ALTER TYPE fulfillment_type ADD VALUE 'partner_fulfillment';

-- 3. Adicionar campos de controle de ERP externo na tabela de pedidos
ALTER TABLE orders ADD COLUMN IF NOT EXISTS external_erp_id TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS external_erp_status TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS fulfillment_partner_id UUID REFERENCES organizations(id); -- Se um parceiro for outra org no sistema

-- 4. Tabela para mapeamento de status entre ERPs e E-conomia
-- Isso ajuda o Adapter Pattern no backend
CREATE TABLE erp_status_mapping (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    erp_type          TEXT NOT NULL,         -- 'olist_hub', 'omie'
    external_status   TEXT NOT NULL,         -- Status no ERP (ex: 'faturado', '10')
    internal_status   order_status NOT NULL, -- Status no E-conomia (ex: 'preparing')
    description       TEXT,
    created_at        TIMESTAMPTZ DEFAULT now(),
    UNIQUE(erp_type, external_status)
);

-- Inserir mapeamentos base para Olist Hub
INSERT INTO erp_status_mapping (erp_type, external_status, internal_status, description) VALUES
('olist_hub', 'released', 'pending', 'Pedido liberado para separação'),
('olist_hub', 'preparing', 'preparing', 'Sendo preparado'),
('olist_hub', 'invoiced', 'preparing', 'Nota fiscal emitida'),
('olist_hub', 'shipped', 'shipped', 'Despachado'),
('olist_hub', 'delivered', 'delivered', 'Entregue ao cliente'),
('olist_hub', 'canceled', 'cancelled', 'Pedido cancelado');

-- Inserir mapeamentos base para Omie (Exemplo de códigos comuns)
INSERT INTO erp_status_mapping (erp_type, external_status, internal_status, description) VALUES
('omie', '10', 'pending', 'Aguardando Aprovação'),
('omie', '20', 'approved', 'Aprovado'),
('omie', '30', 'preparing', 'Faturamento em Andamento'),
('omie', '40', 'preparing', 'Faturado'),
('omie', '50', 'shipped', 'Enviado / Entregue'),
('omie', '60', 'cancelled', 'Cancelado');

-- 5. Função para registrar o log de comunicação com o ERP
CREATE TABLE erp_sync_logs (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id   UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    order_id          UUID REFERENCES orders(id) ON DELETE SET NULL,
    erp_type          TEXT NOT NULL,
    direction         TEXT NOT NULL,         -- 'inbound', 'outbound'
    method            TEXT,                  -- 'IncluirPedido', 'ObterEstoque'
    payload           JSONB,
    response          JSONB,
    status_code       INT,
    error             TEXT,
    created_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_erp_logs_org ON erp_sync_logs(organization_id, created_at DESC);
CREATE INDEX idx_erp_logs_order ON erp_sync_logs(order_id);

COMMENT ON TABLE erp_status_mapping IS 'De/Para de status entre ERPs externos e o pipeline do E-conomia';
