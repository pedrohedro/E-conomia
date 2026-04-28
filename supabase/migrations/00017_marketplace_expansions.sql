-- 00017_marketplace_expansions.sql
-- ECOM-51..55 | Suporte a novos marketplaces
-- Adiciona novos valores ao enum marketplace_type (a coluna é enum, não text+check)

-- ALTER TYPE ADD VALUE IF NOT EXISTS (Postgres 9.6+)
-- IMPORTANTE: cada ADD VALUE deve estar em statement separado e os valores
-- não podem ser usados na mesma transação em que são adicionados.
alter type public.marketplace_type add value if not exists 'bling';
alter type public.marketplace_type add value if not exists 'anymarket';
alter type public.marketplace_type add value if not exists 'magazine_luiza';
alter type public.marketplace_type add value if not exists 'americanas';
alter type public.marketplace_type add value if not exists 'casas_bahia';
alter type public.marketplace_type add value if not exists 'carrefour';
alter type public.marketplace_type add value if not exists 'via_varejo';
alter type public.marketplace_type add value if not exists 'shoptime';
alter type public.marketplace_type add value if not exists 'samsung_shop';
alter type public.marketplace_type add value if not exists 'netshoes';
alter type public.marketplace_type add value if not exists 'dafiti';
alter type public.marketplace_type add value if not exists 'centauro';
alter type public.marketplace_type add value if not exists 'proprio';

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

drop policy if exists "webhooks: own org" on public.marketplace_webhooks;
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
