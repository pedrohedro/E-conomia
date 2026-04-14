-- 00016_purchase_orders.sql
-- ECOM-46 | Gestão de Compras — Ordens de Compra a Fornecedores

create table if not exists public.suppliers (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null,
  cnpj            text,
  email           text,
  phone           text,
  contact_name    text,
  payment_terms   text default 'À Vista',
  notes           text,
  created_at      timestamptz not null default now()
);

create table if not exists public.purchase_orders (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  supplier_id     uuid references public.suppliers(id) on delete set null,
  order_number    text not null,
  status          text not null default 'draft'
                    check (status in ('draft','sent','confirmed','received','cancelled')),
  total_amount    numeric(12,2) not null default 0,
  notes           text,
  expected_at     date,
  received_at     date,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists public.purchase_order_items (
  id                uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  product_name      text not null,
  sku               text,
  quantity          int not null default 1,
  unit_cost         numeric(12,2) not null default 0,
  total_cost        numeric(12,2) generated always as (quantity * unit_cost) stored
);

-- RLS
alter table public.suppliers enable row level security;
alter table public.purchase_orders enable row level security;
alter table public.purchase_order_items enable row level security;

create policy "suppliers: own org" on public.suppliers
  using (organization_id in (select organization_id from public.organization_members where user_id = auth.uid()));
create policy "suppliers: insert own org" on public.suppliers for insert
  with check (organization_id in (select organization_id from public.organization_members where user_id = auth.uid()));
create policy "suppliers: update own org" on public.suppliers for update
  using (organization_id in (select organization_id from public.organization_members where user_id = auth.uid()));

create policy "purchase_orders: own org" on public.purchase_orders
  using (organization_id in (select organization_id from public.organization_members where user_id = auth.uid()));
create policy "purchase_orders: insert" on public.purchase_orders for insert
  with check (organization_id in (select organization_id from public.organization_members where user_id = auth.uid()));
create policy "purchase_orders: update" on public.purchase_orders for update
  using (organization_id in (select organization_id from public.organization_members where user_id = auth.uid()));

create policy "purchase_order_items: own org" on public.purchase_order_items
  using (organization_id in (select organization_id from public.organization_members where user_id = auth.uid()));
create policy "purchase_order_items: insert" on public.purchase_order_items for insert
  with check (organization_id in (select organization_id from public.organization_members where user_id = auth.uid()));

-- Notifications table (caso não exista)
create table if not exists public.notifications (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  type            text not null,
  title           text not null,
  message         text not null,
  severity        text default 'low' check (severity in ('low','medium','high')),
  data            jsonb default '{}'::jsonb,
  read            boolean default false,
  created_at      timestamptz not null default now()
);
alter table public.notifications enable row level security;
create policy "notifications: own org" on public.notifications
  using (organization_id in (select organization_id from public.organization_members where user_id = auth.uid()));
create policy "notifications: insert own org" on public.notifications for insert
  with check (organization_id in (select organization_id from public.organization_members where user_id = auth.uid()));
create policy "notifications: update own org" on public.notifications for update
  using (organization_id in (select organization_id from public.organization_members where user_id = auth.uid()));
create policy "notifications: delete own org" on public.notifications for delete
  using (organization_id in (select organization_id from public.organization_members where user_id = auth.uid()));
