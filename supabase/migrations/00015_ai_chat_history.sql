-- 00015_ai_chat_history.sql
-- ECOM-39 | AI Chat com Dados
-- Armazena histórico de conversas do assistente AI por organização

create table if not exists public.ai_chat_history (
  id            uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  role          text not null check (role in ('user', 'assistant')),
  content       text not null,
  metadata      jsonb default '{}'::jsonb,  -- dados usados p/ gerar resposta (query results)
  created_at    timestamptz not null default now()
);

-- Index para busca por org + tempo (paginação do histórico)
create index ai_chat_history_org_created
  on public.ai_chat_history (organization_id, created_at desc);

-- RLS: usuário só vê histórico da sua própria organização
alter table public.ai_chat_history enable row level security;

create policy "ai_chat_history: read own org"
  on public.ai_chat_history for select
  using (
    organization_id in (
      select organization_id from public.org_members
      where user_id = auth.uid()
    )
  );

create policy "ai_chat_history: insert own org"
  on public.ai_chat_history for insert
  with check (
    organization_id in (
      select organization_id from public.org_members
      where user_id = auth.uid()
    )
  );

create policy "ai_chat_history: delete own messages"
  on public.ai_chat_history for delete
  using (user_id = auth.uid());

-- View: resumo de vendas por dia (context para o AI)
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

-- View: top produtos mais vendidos (context para o AI)
-- Nota: order_items não tem organization_id; obtemos via join com orders.
create or replace view public.vw_ai_top_products as
select
  o.organization_id,
  oi.product_name,
  oi.sku,
  sum(oi.quantity)                as units_sold,
  sum(oi.quantity * oi.unit_price) as revenue,
  count(distinct oi.order_id)    as orders_count
from public.order_items oi
join public.orders o on o.id = oi.order_id
where o.marketplace_created_at > now() - interval '30 days'
  and o.status not in ('cancelled', 'returned')
group by 1, 2, 3
order by 4 desc;

-- View: estoque atual com alerta de ruptura
create or replace view public.vw_ai_inventory_status as
select
  p.organization_id,
  p.name,
  p.sku,
  coalesce(sum(cs.quantity), 0) as total_stock,
  case
    when coalesce(sum(cs.quantity), 0) = 0 then 'out_of_stock'
    when coalesce(sum(cs.quantity), 0) <= 5 then 'critical'
    when coalesce(sum(cs.quantity), 0) <= 20 then 'low'
    else 'ok'
  end as stock_status
from public.products p
left join public.channel_stock cs on cs.product_id = p.id
group by 1, 2, 3;
