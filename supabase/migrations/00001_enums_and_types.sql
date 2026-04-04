-- ============================================================================
-- E-CONOMIA: Migration 00001 - Enums e Tipos Base
-- Tipos enumerados usados em todo o sistema
-- ============================================================================

-- Papéis dentro de uma organização
CREATE TYPE user_role AS ENUM (
  'owner',        -- Dono da conta, acesso total
  'admin',        -- Administrador, quase tudo
  'manager',      -- Gerente, acesso operacional
  'viewer'        -- Visualizador, somente leitura
);

-- Marketplaces suportados
CREATE TYPE marketplace_type AS ENUM (
  'mercado_livre',
  'amazon',
  'shopee',
  'nuvemshop',
  'shein',
  'shopify',
  'tiktok_shop',
  'olx'
);

-- Status de conexão OAuth do marketplace
CREATE TYPE integration_status AS ENUM (
  'disconnected',    -- Não conectado
  'connecting',      -- Em processo de conexão OAuth
  'active',          -- Conectado e funcionando
  'token_expired',   -- Token expirou, precisa renovar
  'error',           -- Erro na integração
  'suspended'        -- Suspensa manualmente
);

-- Tipo de fulfillment/logística
CREATE TYPE fulfillment_type AS ENUM (
  'ml_full',          -- Mercado Livre Full (armazém ML)
  'ml_flex',          -- Mercado Livre Flex (entrega própria)
  'ml_coleta',        -- Mercado Livre Coleta (Correios)
  'amazon_fba',       -- Amazon Fulfillment by Amazon
  'amazon_dba',       -- Amazon Delivery by Amazon
  'shopee_xpress',    -- Shopee Xpress
  'correios_sedex',   -- Correios SEDEX
  'correios_pac',     -- Correios PAC
  'transportadora',   -- Transportadora terceirizada
  'retirada'          -- Retirada no local
);

-- Status do pedido no pipeline logístico
CREATE TYPE order_status AS ENUM (
  'pending',          -- Pedido recebido, aguardando processamento
  'approved',         -- Pagamento aprovado
  'preparing',        -- Em preparação (embalar, NFe)
  'packed',           -- Embalado, pronto para coleta
  'shipped',          -- Despachado / Em trânsito
  'delivered',        -- Entregue ao cliente
  'cancelled',        -- Cancelado
  'returned'          -- Devolvido
);

-- Status da Nota Fiscal Eletrônica
CREATE TYPE nfe_status AS ENUM (
  'pending',       -- Pendente de emissão
  'processing',    -- Em processamento
  'issued',        -- Emitida (NFe gerada)
  'cancelled',     -- Cancelada
  'denied'         -- Denegada pela SEFAZ
);

-- Status da etiqueta de envio
CREATE TYPE shipping_label_status AS ENUM (
  'pending',       -- Pendente
  'generated',     -- Gerada
  'printed',       -- Impressa
  'collected'      -- Coletada pela transportadora
);

-- Tipo de despesa
CREATE TYPE expense_type AS ENUM (
  'fixed',          -- Custo fixo (aluguel, salários)
  'variable',       -- Custo variável (fornecedores, ads)
  'tax',            -- Impostos (DAS, ICMS)
  'pro_labore',     -- Pró-labore dos sócios
  'one_time'        -- Gasto avulso
);

-- Método de pagamento
CREATE TYPE payment_method AS ENUM (
  'pix',
  'boleto',
  'credit_card',
  'debit_card',
  'bank_transfer',
  'cash',
  'marketplace_credit'  -- Crédito do marketplace
);

-- Tipo de movimentação financeira
CREATE TYPE financial_entry_type AS ENUM (
  'income',         -- Entrada (repasse de marketplace, venda direta)
  'expense'         -- Saída (despesa, imposto, fornecedor)
);

-- Nível de alerta de estoque
CREATE TYPE stock_alert_level AS ENUM (
  'normal',         -- Estoque saudável
  'low',            -- Estoque baixo (atenção)
  'critical',       -- Estoque crítico (repor urgente)
  'out_of_stock'    -- Sem estoque
);
