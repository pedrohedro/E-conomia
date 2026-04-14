-- 00018_oauth_states.sql
-- Anti-CSRF: armazena state tokens temporários para fluxo OAuth
-- Expira automaticamente em 10 minutos

create table if not exists public.oauth_states (
  state           text primary key,
  organization_id uuid not null,
  user_id         uuid not null,
  marketplace     text not null,
  shop            text,           -- Apenas Shopify: domínio da loja
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null default (now() + interval '10 minutes')
);

-- Sem RLS: esta tabela é acessada apenas por Edge Functions via service_role
-- Limpeza automática de estados expirados
create index if not exists oauth_states_expires_idx on public.oauth_states (expires_at);

comment on table public.oauth_states is 'Tokens temporários anti-CSRF para fluxo OAuth de marketplaces. Expiram em 10min.';
