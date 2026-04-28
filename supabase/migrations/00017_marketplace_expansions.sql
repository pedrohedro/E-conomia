-- 00017_marketplace_expansions.sql
-- ECOM-51..55 | Suporte a novos marketplaces
-- Expande o check constraint de marketplace para incluir todos os canais

-- Adiciona novos valores ao enum de marketplace (se existir como tipo)
-- Caso seja text com check constraint, atualiza a constraint

-- marketplace_integrations: alarga constraint
alter table public.marketplace_integrations
  drop constraint if exists marketplace_integrations_marketplace_check;

alter table public.marketplace_integrations
  add constraint marketplace_integrations_marketplace_check
  check (marketplace in (
    'mercado_livre',
    'nuvemshop',
    'amazon',
    'shopee',
    'shopify',
    'bling',        -- ERP: sync bidirecional
    'anymarket',    -- Hub: Magalu, Americanas, Casas Bahia, Carrefour, OLX
    'magazine_luiza',
    'americanas',
    'casas_bahia',
    'carrefour',
    'via_varejo',
    'tiktok_shop',
    'shoptime',
    'olx',
    'samsung_shop',
    'netshoes',
    'dafiti',
    'centauro'
  ));

-- orders: mesmos canais
alter table public.orders
  drop constraint if exists orders_marketplace_check;

alter table public.orders
  add constraint orders_marketplace_check
  check (marketplace in (
    'mercado_livre', 'nuvemshop', 'amazon', 'shopee', 'shopify',
    'bling', 'anymarket', 'magazine_luiza', 'americanas', 'casas_bahia',
    'carrefour', 'via_varejo', 'tiktok_shop', 'shoptime', 'olx',
    'samsung_shop', 'netshoes', 'dafiti', 'centauro'
  ));

-- customers: mesmos canais
alter table public.customers
  drop constraint if exists customers_marketplace_check;

alter table public.customers
  add constraint customers_marketplace_check
  check (marketplace in (
    'mercado_livre', 'nuvemshop', 'amazon', 'shopee', 'shopify',
    'bling', 'anymarket', 'magazine_luiza', 'americanas', 'casas_bahia',
    'carrefour', 'via_varejo', 'tiktok_shop', 'shoptime', 'olx',
    'samsung_shop', 'netshoes', 'dafiti', 'centauro', 'proprio'
  ));

-- Tabela de configuração de webhooks por marketplace
create table if not exists public.marketplace_webhooks (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  integration_id  uuid references public.marketplace_integrations(id) on delete cascade,
  marketplace     text not null,
  event_type      text not null,  -- orders/created, inventory/updated, etc.
  endpoint_url    text,
  secret          text,
  active          boolean default true,
  created_at      timestamptz not null default now()
);

alter table public.marketplace_webhooks enable row level security;
create policy "webhooks: own org"
  on public.marketplace_webhooks for all
  using (organization_id in (
    select organization_id from public.org_members where user_id = auth.uid()
  ));

-- View atualizada para suportar novos canais no AI context
create or replace view public.vw_ai_sales_summary as
select
  o.organization_id,
  date_trunc('day', o.marketplace_created_at)::date as sale_date,
  o.marketplace,
  count(*)                                           as orders,
  sum(o.gross_amount)                                as gross_revenue,
  sum(o.marketplace_fee_amt)                         as fees,
  sum(o.gross_amount - o.marketplace_fee_amt)        as net_revenue,
  avg(o.gross_amount)                                as avg_ticket,
  count(*) filter (where o.status = 'cancelled')     as cancellations
from public.orders o
where o.marketplace_created_at > now() - interval '90 days'
group by 1, 2, 3;

-- Índice para performance em organizações com muitos canais
create index if not exists orders_marketplace_org_idx
  on public.orders (organization_id, marketplace, marketplace_created_at desc);

comment on table public.marketplace_webhooks is 'Registro de webhooks configurados por canal de venda';
