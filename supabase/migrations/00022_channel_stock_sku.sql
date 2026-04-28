-- 00022_channel_stock_sku.sql
-- Adiciona channel_sku a channel_stock para mapear SKU do marketplace
-- Necessário para reconcile-stock e push-stock-to-ml

ALTER TABLE public.channel_stock
  ADD COLUMN IF NOT EXISTS channel_sku TEXT;

ALTER TABLE public.channel_stock
  ADD COLUMN IF NOT EXISTS marketplace TEXT;

COMMENT ON COLUMN public.channel_stock.channel_sku IS
  'ID externo do anúncio/produto no marketplace (ex: MLB12345 no ML)';
COMMENT ON COLUMN public.channel_stock.marketplace IS
  'Marketplace dono deste canal (mercado_livre, nuvemshop, amazon, etc.)';

-- Índice para busca por channel_sku
CREATE INDEX IF NOT EXISTS idx_channel_stock_channel_sku
  ON public.channel_stock(organization_id, channel_sku)
  WHERE channel_sku IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_channel_stock_marketplace
  ON public.channel_stock(organization_id, marketplace)
  WHERE marketplace IS NOT NULL;

-- Atualiza marketplace com base no channel enum já existente
UPDATE public.channel_stock SET marketplace =
  CASE
    WHEN channel IN ('ml_full', 'ml_flex') THEN 'mercado_livre'
    WHEN channel = 'amazon_fba'            THEN 'amazon'
    WHEN channel = 'nuvemshop'             THEN 'nuvemshop'
    WHEN channel = 'shopee'                THEN 'shopee'
    ELSE NULL
  END
WHERE marketplace IS NULL;

-- Popula channel_sku a partir de stock_locations.external_id onde disponível
UPDATE public.channel_stock cs
SET channel_sku = sl.external_id
FROM public.stock_locations sl
WHERE sl.channel_stock_id = cs.id
  AND sl.external_id IS NOT NULL
  AND cs.channel_sku IS NULL;
