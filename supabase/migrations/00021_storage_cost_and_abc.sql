-- 00021_storage_cost_and_abc.sql
-- ECOM-92 | Custo de Armazenagem Full na Margem
-- ECOM-90 | Curva ABC — Análise de Giro por Produto

-- Tabela para configurar custo de armazenagem por produto no ML Full
create table if not exists public.storage_costs (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  product_id      uuid references public.products(id) on delete cascade,
  sku             text,
  fulfillment_type text not null default 'ml_full'
                    check (fulfillment_type in ('ml_full', 'amazon_fba')),
  cost_per_unit   numeric(10,4) not null default 0,   -- R$/unidade/mês
  storage_days    int not null default 30,              -- dias em armazenagem (média)
  last_updated_at timestamptz default now(),
  notes           text
);

alter table public.storage_costs enable row level security;

drop policy if exists "storage_costs: own org" on public.storage_costs;
create policy "storage_costs: own org" on public.storage_costs
  using (organization_id in (select organization_id from public.org_members where user_id = auth.uid()));

drop policy if exists "storage_costs: insert own org" on public.storage_costs;
create policy "storage_costs: insert own org" on public.storage_costs for insert
  with check (organization_id in (select organization_id from public.org_members where user_id = auth.uid()));

drop policy if exists "storage_costs: update own org" on public.storage_costs;
create policy "storage_costs: update own org" on public.storage_costs for update
  using (organization_id in (select organization_id from public.org_members where user_id = auth.uid()));

drop policy if exists "storage_costs: delete own org" on public.storage_costs;
create policy "storage_costs: delete own org" on public.storage_costs for delete
  using (organization_id in (select organization_id from public.org_members where user_id = auth.uid()));

drop policy if exists "storage_costs: service_role bypass" on public.storage_costs;
create policy "storage_costs: service_role bypass" on public.storage_costs
  using (auth.role() = 'service_role');

-- View para margem líquida com custo de armazenagem
-- security_invoker=true: a view executa com permissões do caller (RLS aplicada)
create or replace view public.vw_margin_with_storage
  with (security_invoker = true) as
  with fee_per_order as (
    select o.id as order_id,
           coalesce(o.marketplace_fee_amt / greatest((select count(*) from public.order_items x where x.order_id = o.id), 1), 0) as fee_per_item
    from public.orders o
  )
  select
    oi.organization_id,
    oi.order_id,
    o.marketplace_order_id,
    o.status,
    o.marketplace,
    oi.product_name,
    oi.sku,
    oi.quantity,
    oi.unit_price,
    (oi.unit_price * oi.quantity)                           as gross_revenue,
    coalesce(o.marketplace_fee_pct, 0)                      as fee_pct,
    f.fee_per_item                                          as fee_per_item,
    coalesce(sc.cost_per_unit * oi.quantity, 0)             as storage_cost,
    -- Receita líquida aproximada = gross - taxa proporcional - armazenagem
    (oi.unit_price * oi.quantity) - f.fee_per_item - coalesce(sc.cost_per_unit * oi.quantity, 0) as net_revenue,
    o.marketplace_created_at
  from public.order_items oi
  join public.orders o      on o.id = oi.order_id
  join fee_per_order f      on f.order_id = o.id
  left join public.storage_costs sc
    on sc.organization_id = oi.organization_id
    and sc.sku = oi.sku
    and sc.fulfillment_type = 'ml_full';

-- Índices de suporte para a view de curva ABC (coluna correta = movement_type)
create index if not exists idx_stock_movements_org_movtype_date
  on public.stock_movements(organization_id, movement_type, created_at);

create index if not exists idx_stock_movements_product_movtype
  on public.stock_movements(product_id, movement_type);
