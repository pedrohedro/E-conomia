# E-CONOMIA — Arquitetura Backend Completa

## Visão Geral

CRM/ERP para e-commerce multi-marketplace, construído 100% sobre **Supabase** (PostgreSQL + Auth + Realtime + Edge Functions + Storage).

```
┌─────────────────────────────────────────────────────────────────┐
│                        FRONTEND (HTML/JS)                       │
│  dashboard.html │ vendas.html │ estoque.html │ contabil.html    │
└────────┬──────────────┬──────────────┬──────────────┬───────────┘
         │              │              │              │
         ▼              ▼              ▼              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    SUPABASE CLIENT (JS SDK)                     │
│  supabase.auth │ supabase.from() │ supabase.channel() │ storage│
└────────┬──────────────┬──────────────┬──────────────┬───────────┘
         │              │              │              │
         ▼              ▼              ▼              ▼
┌─────────────────────────────────────────────────────────────────┐
│                         SUPABASE CLOUD                          │
│                                                                 │
│  ┌──────────┐  ┌──────────────┐  ┌──────────┐  ┌────────────┐  │
│  │   Auth   │  │  PostgreSQL  │  │ Realtime │  │  Storage   │  │
│  │  (GoTrue)│  │   + RLS      │  │ (WS)     │  │  (S3)      │  │
│  └──────────┘  └──────────────┘  └──────────┘  └────────────┘  │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              Edge Functions (Deno)                        │   │
│  │  marketplace-oauth │ sync-orders │ webhook-handler │ cron │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              PostgreSQL Functions & Triggers              │   │
│  │  RLS policies │ stock_recalc │ notifications │ stats      │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
         │              │              │
         ▼              ▼              ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│ Mercado Livre│ │    Amazon    │ │    Shopee    │  ...
│   API REST   │ │  SP-API      │ │   Open API   │
└──────────────┘ └──────────────┘ └──────────────┘
```

---

## 1. Modelo de Dados (Database Schema)

### 1.1 Diagrama de Relacionamentos

```
organizations (tenant)
  ├── org_members ──→ auth.users ──→ profiles
  ├── marketplace_integrations
  │     └── sync_logs
  ├── suppliers
  ├── products
  │     ├── channel_stock (por canal)
  │     └── stock_movements (log)
  ├── customers
  ├── orders
  │     └── order_items ──→ products
  ├── expense_categories
  ├── expenses
  ├── cash_flow_entries
  ├── marketplace_payouts
  ├── daily_sales_metrics
  ├── regional_sales
  ├── health_scores
  └── notifications
```

### 1.2 Tabelas por Módulo

| Módulo | Tabelas | Arquivo de Migration |
|--------|---------|---------------------|
| Core | `organizations`, `profiles`, `org_members` | `00002_core_tables.sql` |
| Integrações | `marketplace_integrations`, `sync_logs` | `00003_marketplace_integrations.sql` |
| Produtos | `suppliers`, `products`, `channel_stock`, `stock_movements` | `00004_products_inventory.sql` |
| Pedidos | `customers`, `orders`, `order_items` | `00005_orders.sql` |
| Financeiro | `expense_categories`, `expenses`, `cash_flow_entries`, `marketplace_payouts` | `00006_financial.sql` |
| Analytics | `daily_sales_metrics`, `regional_sales`, `health_scores` | `00007_analytics.sql` |
| Segurança | RLS policies | `00008_rls_policies.sql` |
| Storage | Buckets + políticas | `00009_storage_buckets.sql` |
| Realtime | Publicações + notificações | `00010_realtime_and_notifications.sql` |

### 1.3 Campos Computados (Generated Columns)

- `products.margin_percent` = `(sale_price - cost_price) / sale_price * 100`
- `channel_stock.available` = `quantity - reserved`
- `orders.net_amount` = `gross_amount - marketplace_fee_amt - shipping_cost - discount_amount`
- `daily_sales_metrics.conversion_rate` = `orders_count / visits * 100`
- `daily_sales_metrics.roi_ads` = `(net_revenue - ads_cost) / ads_cost * 100`

### 1.4 Triggers Automáticos

| Trigger | Tabela | Ação |
|---------|--------|------|
| `recalculate_product_stock` | `channel_stock` | Recalcula `total_stock` e `stock_alert` no produto |
| `notify_stock_alert` | `products` | Cria notificação quando estoque fica crítico |
| `notify_new_order` | `orders` | Cria notificação quando pedido é aprovado |
| `update_customer_stats` | `orders` | Atualiza contadores do cliente |
| `handle_new_user` | `auth.users` | Cria perfil automaticamente no registro |
| `on_org_created` | `organizations` | Popula categorias padrão de despesas |
| `update_updated_at` | Várias | Atualiza `updated_at` automaticamente |

---

## 2. Estratégia de Autenticação (Supabase Auth)

### 2.1 Fluxo de Registro

```
1. Usuário preenche formulário (email + senha + nome)
2. supabase.auth.signUp({ email, password, options: { data: { full_name } } })
3. Trigger `handle_new_user` cria registro em `profiles`
4. Frontend redireciona para tela de "Criar Organização"
5. Edge Function `create-organization`:
   a. INSERT em `organizations`
   b. INSERT em `org_members` (role: 'owner')
   c. Trigger `on_org_created` popula categorias padrão
6. Usuário é redirecionado ao Dashboard
```

### 2.2 Fluxo de Login

```
1. supabase.auth.signInWithPassword({ email, password })
2. JWT retornado contém user.id
3. Todas as queries passam por RLS usando auth.uid()
4. Frontend carrega org_members para saber a organização ativa
```

### 2.3 Modelo de Papéis (RBAC)

```
owner    → Acesso total, gerenciar membros, deletar org
admin    → Gerenciar integrações, configurações, membros
manager  → Operacional: produtos, pedidos, despesas
viewer   → Somente leitura em tudo
```

A hierarquia é imposta pelo enum `user_role` (owner < admin < manager < viewer) e pela função `user_has_role(org_id, min_role)`.

### 2.4 Convidar Membros da Equipe

```
1. Admin vai em Configurações → Equipe → Convidar
2. Edge Function `invite-member`:
   a. Verifica se o email já tem conta
   b. INSERT em `org_members` com `invited_email` e `invited_at`
   c. Envia email de convite via Supabase Auth (magic link ou invite)
3. Membro aceita → accepted_at é preenchido
```

---

## 3. Camada de API

### 3.1 Operações Diretas via Supabase Client

O SDK do Supabase (supabase-js) deve ser usado para todo CRUD simples:

```javascript
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// Listar produtos da organização (RLS filtra automaticamente)
const { data } = await supabase
  .from('products')
  .select(`
    *,
    supplier:suppliers(name),
    stocks:channel_stock(channel, quantity, available)
  `)
  .eq('organization_id', orgId)
  .order('name')

// Criar despesa
await supabase.from('expenses').insert({
  organization_id: orgId,
  description: 'Fornecedor: Dux Nutrition',
  amount: 4500.00,
  expense_type: 'variable',
  due_date: '2026-03-15',
  payment_method: 'pix',
  marketplace: 'mercado_livre'
})

// Buscar pedidos com filtros
const { data: orders } = await supabase
  .from('orders')
  .select(`
    *,
    customer:customers(name, city, state),
    items:order_items(product_name, quantity, unit_price)
  `)
  .eq('organization_id', orgId)
  .eq('marketplace', 'mercado_livre')
  .in('status', ['preparing', 'packed'])
  .order('marketplace_created_at', { ascending: false })
  .range(0, 49) // Paginação
```

### 3.2 Operações que Necessitam Edge Functions

| Edge Function | Motivo | Trigger |
|---------------|--------|---------|
| `marketplace-oauth` | Fluxo OAuth com redirect, troca de code por token | Botão "Conectar" no frontend |
| `marketplace-token-refresh` | Renovar access_token expirado | Cron (a cada 30min) |
| `sync-orders` | Chamar API do marketplace, importar pedidos | Cron (a cada 5-15min) ou webhook |
| `sync-stock` | Atualizar estoque no marketplace após venda | Trigger de mudança em `channel_stock` |
| `webhook-handler` | Receber notificações do marketplace | POST do marketplace |
| `create-organization` | Criar org + membership + seed | Pós-registro |
| `invite-member` | Convidar membro com email | Tela de configurações |
| `generate-nfe` | Integrar com emissor de NFe (ex: Focus NFe) | Botão "Emitir NFe" |
| `calculate-health-score` | Calcular score de saúde da empresa | Cron diário |
| `generate-daily-metrics` | Agregar métricas do dia | Cron meia-noite |

### 3.3 RPCs (Funções PostgreSQL chamadas via supabase.rpc())

```sql
-- Exemplo: Dashboard KPIs rápido (uma query otimizada)
CREATE OR REPLACE FUNCTION get_dashboard_kpis(p_org_id UUID, p_period TEXT DEFAULT 'month')
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSON;
  start_date DATE;
BEGIN
  -- Verificar acesso
  IF NOT EXISTS (
    SELECT 1 FROM org_members
    WHERE organization_id = p_org_id AND user_id = auth.uid() AND is_active
  ) THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  start_date := CASE p_period
    WHEN 'today' THEN CURRENT_DATE
    WHEN 'week' THEN CURRENT_DATE - 7
    WHEN 'month' THEN DATE_TRUNC('month', CURRENT_DATE)
    ELSE DATE_TRUNC('month', CURRENT_DATE)
  END;

  SELECT json_build_object(
    'gross_revenue', COALESCE(SUM(gross_amount), 0),
    'net_revenue', COALESCE(SUM(net_amount), 0),
    'total_fees', COALESCE(SUM(marketplace_fee_amt), 0),
    'order_count', COUNT(*),
    'avg_ticket', COALESCE(AVG(gross_amount), 0),
    'stock_value', (SELECT COALESCE(SUM(cost_price * total_stock), 0) FROM products WHERE organization_id = p_org_id),
    'cash_balance', (
      SELECT COALESCE(SUM(CASE entry_type WHEN 'income' THEN amount ELSE -amount END), 0)
      FROM cash_flow_entries
      WHERE organization_id = p_org_id AND is_confirmed
    )
  ) INTO result
  FROM orders
  WHERE organization_id = p_org_id
    AND marketplace_created_at >= start_date
    AND status NOT IN ('cancelled', 'returned');

  RETURN result;
END;
$$;
```

---

## 4. Arquitetura de Integração com Marketplaces

### 4.1 Fluxo OAuth Genérico

```
Frontend                    Edge Function              Marketplace API
   │                            │                           │
   │  1. Clica "Conectar ML"    │                           │
   ├───────────────────────────►│                           │
   │                            │  2. Gera state + redireciona
   │  ◄─ redirect ──────────────┤                           │
   │                            │                           │
   │  3. Usuário autoriza ─────────────────────────────────►│
   │                            │                           │
   │  ◄── redirect com code ────────────────────────────────┤
   │                            │                           │
   │  4. Envia code ───────────►│                           │
   │                            │  5. POST /oauth/token ───►│
   │                            │  ◄── access + refresh ────┤
   │                            │                           │
   │                            │  6. Salva tokens criptografados
   │                            │     em marketplace_integrations
   │  ◄── sucesso ──────────────┤                           │
```

### 4.2 Endpoints por Marketplace

| Marketplace | Auth | Domínio API | Particularidades |
|-------------|------|-------------|-----------------|
| Mercado Livre | OAuth 2.0 | `api.mercadolibre.com` | Token expira em 6h, refresh disponível |
| Amazon (SP-API) | OAuth 2.0 + STS | `sellingpartnerapi-na.amazon.com` | Requer IAM Role + STS, complexo |
| Shopee | OAuth 2.0 + HMAC | `partner.shopeemobile.com` | Sign com partner_key + timestamp |
| Nuvemshop | OAuth 2.0 | `api.nuvemshop.com.br` | Mais simples, token sem expiração |

### 4.3 Estratégia de Token

```
┌─────────────────────────────────────────────────┐
│          marketplace_integrations               │
│                                                 │
│  access_token   → Usado para chamadas API       │
│  refresh_token  → Usado para renovar access     │
│  token_expires_at → Quando o access expira      │
│                                                 │
│  Cron (30min): Edge Function verifica           │
│    tokens que expiram em < 1h e renova          │
└─────────────────────────────────────────────────┘
```

**Segurança dos tokens:**
- Armazenados na tabela `marketplace_integrations` com RLS
- Acesso somente por Edge Functions (service_role key)
- Frontend NUNCA acessa tokens diretamente
- Considerar Supabase Vault para criptografia adicional no futuro

### 4.4 Webhook Handling

```
Marketplace ──POST──► Edge Function (webhook-handler)
                           │
                           ├─ Valida assinatura (HMAC/secret)
                           ├─ Identifica organização pelo seller_id
                           ├─ Processa evento:
                           │   ├─ order.created → upsert orders
                           │   ├─ order.shipped → update status
                           │   ├─ payment.approved → update financial
                           │   └─ stock.changed → sync channel_stock
                           └─ Registra em sync_logs
```

### 4.5 Rate Limiting

| Marketplace | Limite | Estratégia |
|-------------|--------|-----------|
| Mercado Livre | ~10 req/s | Queue com delay, batch requests |
| Amazon SP-API | ~1 req/s (varia) | Exponential backoff, tokens de burst |
| Shopee | ~5 req/s | Delay entre requests |
| Nuvemshop | ~2 req/s | Queue simples |

Usar `pg_cron` ou Supabase Cron para agendar syncs incrementais a cada 5-15 minutos.

---

## 5. Features Realtime

### 5.1 Tabelas com Realtime Habilitado

| Tabela | Canal | Uso no Frontend |
|--------|-------|-----------------|
| `orders` | `INSERT`, `UPDATE` | Feed de vendas ao vivo (vendas.html) |
| `notifications` | `INSERT` | Alertas de estoque, novos pedidos |
| `channel_stock` | `UPDATE` | Atualização de quantidades em tempo real |
| `cash_flow_entries` | `INSERT` | Calendário financeiro ao vivo |

### 5.2 Implementação do Feed de Vendas ao Vivo

```javascript
// Escutar novos pedidos da organização em tempo real
const channel = supabase
  .channel('live-sales')
  .on(
    'postgres_changes',
    {
      event: 'INSERT',
      schema: 'public',
      table: 'orders',
      filter: `organization_id=eq.${orgId}`
    },
    (payload) => {
      const order = payload.new
      prependToLiveFeed({
        product: order.order_number,
        marketplace: order.marketplace,
        amount: order.gross_amount,
        timestamp: order.created_at
      })
    }
  )
  .subscribe()
```

### 5.3 Alertas de Estoque

```javascript
// Escutar notificações de estoque crítico
supabase
  .channel('stock-alerts')
  .on(
    'postgres_changes',
    {
      event: 'INSERT',
      schema: 'public',
      table: 'notifications',
      filter: `organization_id=eq.${orgId}`
    },
    (payload) => {
      showToast(payload.new.title, payload.new.severity)
    }
  )
  .subscribe()
```

---

## 6. Storage (Arquivos e Documentos)

### 6.1 Estrutura de Pastas nos Buckets

```
nfe-documents/
  └── {org_id}/
      └── {year}/
          └── {month}/
              ├── {order_id}-nfe.xml
              └── {order_id}-nfe.pdf

shipping-labels/
  └── {org_id}/
      └── {order_id}-label.pdf

product-images/
  └── {org_id}/
      └── {product_id}/
          ├── main.webp
          ├── thumb.webp
          └── gallery-1.webp

avatars/
  └── {user_id}/
      └── avatar.webp
```

### 6.2 Upload de NFe

```javascript
// Após emissão da NFe via Edge Function
const filePath = `${orgId}/${year}/${month}/${orderId}-nfe.pdf`

const { data } = await supabase.storage
  .from('nfe-documents')
  .upload(filePath, pdfBlob, {
    contentType: 'application/pdf',
    upsert: true
  })

// Salvar path no pedido
await supabase
  .from('orders')
  .update({ nfe_file_path: filePath })
  .eq('id', orderId)
```

---

## 7. Fases de Implementação

### Fase 1: Fundação (Semanas 1-2)
**Objetivo:** Auth funcional + CRUD básico

- [ ] Configurar projeto Supabase
- [ ] Executar migrations 00001 a 00003
- [ ] Implementar tela de login/registro no frontend
- [ ] Criar fluxo de onboarding (criar organização)
- [ ] Conectar dashboard.html com dados reais (KPIs via RPC)
- [ ] Substituir dados mock por queries Supabase
- [ ] CRUD de produtos e fornecedores

### Fase 2: Produtos e Estoque (Semanas 3-4)
**Objetivo:** Estoque multi-canal funcionando

- [ ] Executar migration 00004
- [ ] Implementar CRUD de produtos com estoque por canal
- [ ] Tela de transferência de estoque entre canais
- [ ] Alertas automáticos de estoque baixo (trigger)
- [ ] Conectar estoque.html com dados reais
- [ ] Busca full-text de produtos (GIN index)

### Fase 3: Integração Mercado Livre (Semanas 5-8)
**Objetivo:** Primeira integração marketplace real

- [ ] Executar migration 00003 (se não feito)
- [ ] Edge Function: OAuth do Mercado Livre
- [ ] Edge Function: Sync de pedidos (incremental)
- [ ] Edge Function: Webhook handler
- [ ] Mapeamento de produtos (SKU interno ↔ ML)
- [ ] Sync de estoque bidirecional
- [ ] Conectar index.html (botão "Conectar" real)

### Fase 4: Pedidos e Financeiro (Semanas 9-12)
**Objetivo:** Pipeline de pedidos + módulo contábil

- [ ] Executar migrations 00005 e 00006
- [ ] Conectar vendas.html (tabela de pedidos reais)
- [ ] Pipeline logístico (status updates)
- [ ] Módulo de despesas e custos fixos
- [ ] Fluxo de caixa / calendário financeiro
- [ ] Conectar contabil.html com dados reais
- [ ] Integração com emissor de NFe (Focus NFe ou similar)

### Fase 5: Analytics e Realtime (Semanas 13-16)
**Objetivo:** Dashboards dinâmicos + feed ao vivo

- [ ] Executar migrations 00007 e 00010
- [ ] Feed de vendas ao vivo (Realtime)
- [ ] Notificações in-app
- [ ] Health Score automático
- [ ] Métricas diárias (cron)
- [ ] Gráficos de performance (12 meses)
- [ ] Vendas por região (mapa de calor)

### Fase 6: Mais Marketplaces (Semanas 17+)
**Objetivo:** Expandir para outros canais

- [ ] Amazon SP-API (complexidade alta)
- [ ] Shopee Open API
- [ ] Nuvemshop API
- [ ] Shein, Shopify, TikTok Shop (conforme demanda)

---

## 8. Considerações de Performance

### 8.1 Índices Estratégicos

Todos os índices estão documentados nas migrations. Os mais críticos:

- `idx_orders_date` — Queries de pedidos por período (dashboard)
- `idx_products_search` — Busca full-text GIN em português
- `idx_expenses_unpaid` — Partial index para despesas pendentes
- `idx_integrations_token_expiry` — Renovação de tokens

### 8.2 Limites do Supabase Free/Pro

| Recurso | Free | Pro | Estratégia |
|---------|------|-----|-----------|
| Database | 500MB | 8GB | JSONB `raw_data` somente para pedidos recentes |
| Storage | 1GB | 100GB | Limitar tamanho de uploads, comprimir imagens |
| Edge Functions | 500K invocações/mês | 2M | Batch syncs, evitar chamadas unitárias |
| Realtime | 200 conexões | 500 | 1 canal por org, multiplex |
| Bandwidth | 2GB | 250GB | Cache agressivo no frontend |

### 8.3 Otimizações Recomendadas

1. **Paginação obrigatória** em todas as listagens (`.range(0, 49)`)
2. **Select explícito** — nunca `select('*')`, sempre colunas específicas
3. **Views materializadas** para KPIs que não mudam em tempo real
4. **Indexes parciais** para queries frequentes (ex: pedidos pendentes)
5. **Batch inserts** ao sincronizar pedidos do marketplace
6. **Debounce** no Realtime para evitar re-renders excessivos

---

## 9. Segurança

### 9.1 Camadas de Proteção

```
1. Supabase Auth (JWT) → Identidade do usuário
2. RLS Policies → Isolamento multi-tenant automático
3. Role-based checks → user_has_role() para mutações
4. Edge Functions → service_role para operações privilegiadas
5. Storage Policies → Arquivos isolados por org_id
6. Input validation → Constraints + CHECK no PostgreSQL
```

### 9.2 O que o Frontend NUNCA deve acessar

- Tokens OAuth dos marketplaces
- `service_role` key do Supabase
- Dados de outras organizações (garantido por RLS)
- Edge Functions internas (usar `Authorization: Bearer` do user)

### 9.3 Validação de Dados

- Enums PostgreSQL impedem valores inválidos em status
- `CHECK` constraints para ranges (health_score 0-100)
- `UNIQUE` constraints para evitar duplicatas (SKU por org, pedido por marketplace)
- `GENERATED ALWAYS AS` para campos calculados (não manipuláveis)

---

## 10. Mapeamento Frontend → Backend

| Página Frontend | Tabelas Usadas | Funcionalidades |
|-----------------|---------------|-----------------|
| `dashboard.html` | `orders`, `products`, `expenses`, `health_scores`, `daily_sales_metrics` | KPIs, gráfico 12 meses, inventário resumo, contábil pro |
| `vendas.html` | `orders`, `order_items`, `customers`, `regional_sales`, `daily_sales_metrics` | Pipeline logístico, feed ao vivo, tabela de pedidos, regiões |
| `estoque.html` | `products`, `channel_stock`, `suppliers`, `stock_movements` | Tabela de inventário multi-canal, transferências, alertas |
| `contabil.html` | `expenses`, `cash_flow_entries`, `marketplace_payouts`, `expense_categories` | KPIs financeiros, extrato, calendário de caixa |
| `index.html` | `marketplace_integrations` | Cards de conexão OAuth, status de integrações |

---

## 11. Variáveis de Ambiente Necessárias

```env
# Supabase (obrigatório)
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...  # Apenas em Edge Functions

# Mercado Livre
ML_APP_ID=123456
ML_CLIENT_SECRET=xxxxxxxx
ML_REDIRECT_URI=https://xxxxx.supabase.co/functions/v1/marketplace-oauth/callback

# Amazon SP-API
AMAZON_CLIENT_ID=amzn1.application-oa2-client.xxx
AMAZON_CLIENT_SECRET=xxx
AMAZON_REFRESH_TOKEN=xxx

# Shopee
SHOPEE_PARTNER_ID=123456
SHOPEE_PARTNER_KEY=xxxxxxxx

# Nuvemshop
NUVEMSHOP_APP_ID=12345
NUVEMSHOP_CLIENT_SECRET=xxxxxxxx

# NFe (quando implementar)
FOCUS_NFE_TOKEN=xxx
FOCUS_NFE_ENVIRONMENT=production
```

---

**Próximos passos:** Execute as migrations no painel do Supabase (SQL Editor), configure as variáveis de ambiente e comece pela Fase 1.
