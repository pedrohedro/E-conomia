# Auditoria Backend Supabase — CRM E-commerce
**Data:** 2026-04-01
**Projeto Supabase:** rqmpqxguecuhrsbzcwgb
**Escopo:** Migrations 00001-00011, Edge Functions (7), _shared utilities

---

## 1. Mapa de Tabelas e Relacionamentos

### 1.1 Core / Multi-Tenant
| Tabela | Chave Primária | Relacionamentos Relevantes |
|---|---|---|
| `organizations` | UUID | — |
| `profiles` | UUID → `auth.users.id` | 1:1 com auth.users |
| `org_members` | UUID | organization_id → organizations; user_id → auth.users |
| `subscriptions` | UUID | organization_id → organizations |
| `stripe_invoices` | UUID | organization_id → organizations |

### 1.2 Integrações
| Tabela | Relacionamentos |
|---|---|
| `marketplace_integrations` | organization_id → organizations |
| `sync_logs` | integration_id → marketplace_integrations; organization_id → organizations |

### 1.3 Produtos e Estoque
| Tabela | Relacionamentos |
|---|---|
| `suppliers` | organization_id → organizations |
| `products` | organization_id → organizations; supplier_id → suppliers |
| `channel_stock` | organization_id → organizations; product_id → products |
| `stock_movements` | organization_id → organizations; product_id → products; created_by → auth.users |

### 1.4 Pedidos
| Tabela | Relacionamentos |
|---|---|
| `customers` | organization_id → organizations |
| `orders` | organization_id → organizations; customer_id → customers; integration_id → marketplace_integrations |
| `order_items` | order_id → orders; organization_id → organizations; product_id → products |

### 1.5 Financeiro
| Tabela | Relacionamentos |
|---|---|
| `expense_categories` | organization_id → organizations |
| `expenses` | organization_id → organizations; category_id → expense_categories; created_by → auth.users |
| `cash_flow_entries` | organization_id → organizations |
| `marketplace_payouts` | organization_id → organizations; integration_id → marketplace_integrations |

### 1.6 Analytics / Notificações
| Tabela | Relacionamentos |
|---|---|
| `daily_sales_metrics` | organization_id → organizations |
| `regional_sales` | organization_id → organizations |
| `health_scores` | organization_id → organizations |
| `notifications` | organization_id → organizations; user_id → auth.users |

**Total: 22 tabelas de domínio + 2 auth internas (auth.users)**

### 1.7 Views
- `v_monthly_financial_summary` — KPIs financeiros mensais por marketplace
- `v_monthly_expenses` — Resumo de despesas por tipo/mês
- `v_marketplace_performance` — Performance comparativa dos últimos 30 dias

---

## 2. Análise de RLS Policies

### 2.1 Estado Atual — O que está correto

- **Profiles:** Leitura e escrita isoladas por `id = auth.uid()`. Correto.
- **Organizations:** SELECT via `get_user_org_ids()`. INSERT aberto para qualquer auth user (intencional). UPDATE exige `user_has_role(..., 'admin')`. Correto.
- **Marketplace integrations:** CRUD granular — SELECT para membros, INSERT/UPDATE para admin, DELETE para owner. Correto.
- **Sync_logs:** Somente SELECT para membros. Correto — apenas Edge Functions (service_role) escrevem.
- **Orders / order_items / customers:** SELECT para membros, mutations para manager+. Correto.
- **Expenses:** SELECT membros, mutations manager+. Correto.
- **Marketplace_payouts:** SELECT membros, mutations admin+. Correto (financeiro sensível).
- **Daily_sales_metrics / regional_sales / health_scores:** Apenas SELECT. Escrita só via service_role. Correto.
- **Notifications:** SELECT filtrado por org + (user_id IS NULL OR user_id = auth.uid()). UPDATE restrito ao dono. Correto.
- **Subscriptions / stripe_invoices:** SELECT para membros da org, ALL para service_role. Correto.
- **Storage buckets:** Paths isolados por org_id no primeiro segmento. Correto.

### 2.2 Problemas Identificados nas RLS

#### CRITICO-01: Chicken-and-Egg em org_members_insert

**Localização:** migration 00008, linha 58-61

```sql
CREATE POLICY org_members_insert ON org_members
  FOR INSERT WITH CHECK (
    user_has_role(organization_id, 'admin')
  );
```

**Problema:** `user_has_role()` consulta `org_members` para verificar se o usuário é admin da org. Quando um usuário cria uma organização e tenta se adicionar como primeiro membro (owner), ele ainda não existe em `org_members` — portanto `user_has_role()` retorna `FALSE` e o INSERT é bloqueado. O fluxo `createOrganization()` do frontend está quebrado por esta dependência circular.

**Impacto:** Nenhum usuário consegue criar uma organização através do fluxo normal do app. Crítico para onboarding.

**Correção necessária — ver Seção 4.**

---

#### CRITICO-02: Função `update_updated_at_column()` não existe

**Localização:** migration 00011, linha 25-27

```sql
CREATE TRIGGER set_subscriptions_updated_at
  BEFORE UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
```

**Problema:** As migrations 00001-00010 definem a função `update_updated_at()` (sem `_column` no nome). A migration 00011 chama `update_updated_at_column()` — nome diferente. Se a migration 00011 for executada sem que essa função exista no banco remoto, ela falhará com `ERROR: function update_updated_at_column() does not exist`, impedindo que a tabela `subscriptions` e `stripe_invoices` sejam criadas.

**Impacto:** Toda a stack de assinaturas Stripe fica indisponível.

**Correção necessária — ver Seção 4.**

---

#### MEDIO-03: Política `suppliers_mutate` usa FOR ALL sem separar WITH CHECK de USING

**Localização:** migration 00008, linha 100-101

```sql
CREATE POLICY suppliers_mutate ON suppliers
  FOR ALL USING (user_has_role(organization_id, 'manager'));
```

`FOR ALL` com apenas `USING` aplica a mesma condição para SELECT, INSERT, UPDATE e DELETE. Para INSERT, o Postgres usa a cláusula `WITH CHECK`. Quando não especificada em `FOR ALL`, ela herda o `USING`. Neste caso funciona, mas o mesmo padrão em `products_mutate`, `channel_stock_mutate`, `customers_mutate`, `orders_mutate`, `order_items_mutate` e `expenses_mutate` é semanticamente impreciso. Não é um bug funcional hoje, mas pode causar comportamentos inesperados se as políticas forem modificadas.

---

#### MEDIO-04: Ausência de política de DELETE em `sync_logs`

`sync_logs` tem apenas SELECT policy. Não há política de DELETE. Logs antigos não podem ser limpos pelo app. Recomendado adicionar uma política de DELETE para role `admin` ou criar um pg_cron job para purga automática.

---

#### MEDIO-05: Ausência de políticas de escrita em `regional_sales` e `health_scores`

Ambas as tabelas têm apenas `SELECT` policies. A escrita deve ser feita exclusivamente pelo service_role (via Edge Functions), o que está correto em teoria. Porém não há nenhuma policy explícita bloqueando tentativas de INSERT/UPDATE de usuários autenticados — com RLS ativo e sem policy correspondente, o Postgres nega por padrão, então está seguro, mas é implícito. Recomendado adicionar policies explícitas de `service_role` para clareza.

---

#### BAIXO-06: Storage — ausência de política de UPDATE e DELETE para `nfe-documents` e `shipping-labels`

As policies de storage para NFe e etiquetas cobrem apenas SELECT e INSERT. Não há UPDATE nem DELETE. Um usuário que queira substituir uma NFe ou deletar uma etiqueta incorreta ficaria bloqueado. Recomendado adicionar essas policies ou decidir explicitamente que essas operações são restritas ao service_role.

---

#### BAIXO-07: `user_has_role()` usa comparação de enum com operador `<=`

**Localização:** migration 00002, linha 88

```sql
AND role <= min_role  -- enum ordering: owner < admin < manager < viewer
```

O comentário diz que a ordem é `owner < admin < manager < viewer`. No Postgres, a ordem dos valores de um ENUM é a ordem de definição na DDL. Na migration 00001, a ordem é `owner, admin, manager, viewer`, confirmando que `owner` tem valor ordinal 1 e `viewer` tem valor ordinal 4. A lógica `role <= 'admin'` retorna TRUE para `owner` e `admin`. Está funcionando corretamente hoje, mas é frágil: se novos roles forem adicionados ao ENUM em posições intermediárias, a lógica pode quebrar silenciosamente.

---

### 2.3 Tabelas sem nenhuma política de mutação do lado de usuários (intencionais)

As seguintes tabelas são corretas em ter apenas SELECT para usuários — toda a escrita é feita pelo service_role via Edge Functions:
- `sync_logs`
- `daily_sales_metrics`
- `regional_sales`
- `health_scores`
- `marketplace_payouts` (parcialmente — admin pode mutar)

---

## 3. Análise das Edge Functions

### 3.1 Inventário de Funções

| Função | Status | Propósito |
|---|---|---|
| `marketplace-oauth` | Implementada | OAuth2 authorize + callback para ML e Nuvemshop |
| `token-refresh` | Implementada | Renovação de tokens ML expirados (cron) |
| `sync-orders` | Implementada | Sincronização de pedidos ML + Nuvemshop |
| `webhook-handler` | Implementada | Recebe notificações push dos marketplaces |
| `stripe-checkout` | Implementada | Cria sessão de checkout Stripe |
| `stripe-webhook` | Implementada | Processa eventos Stripe (subscription lifecycle) |
| `_shared/cors.ts` | Implementado | CORS headers com whitelist de origens |
| `_shared/supabase.ts` | Implementado | Factories para service client e user client |
| `_shared/marketplace-clients.ts` | Implementado | Clientes HTTP para ML API e Nuvemshop API |

### 3.2 Análise Detalhada por Função

#### `marketplace-oauth`
- **Pontos positivos:** State parameter com org_id + marketplace encodado em base64, redirect direto sem retornar tokens ao frontend, uso de service_role para upsert.
- **Problemas:**
  - O `state` é codificado com `btoa()` mas **não é assinado nem criptografado**. Um atacante pode forjar um state com qualquer `org_id` e vincular tokens de um marketplace à organização errada. Para produção, o state deve ser assinado com HMAC-SHA256 usando um secret, ou armazenado temporariamente no banco com TTL curto.
  - O parâmetro `org_id` na URL de `/authorize` **não é validado** — qualquer usuário autenticado pode conectar uma integração a qualquer `org_id`, mesmo que não seja membro dela.
  - A função `handleAuthorize` recebe `_req` mas não valida o JWT do usuário. Não há verificação de autenticação no fluxo de authorize.

#### `token-refresh`
- **Pontos positivos:** Lógica correta, trata erros individuais sem parar o loop, registra em sync_logs.
- **Problema:** A função não tem proteção de invocação. Qualquer requisição POST sem autenticação pode disparar refresh de tokens. Em produção, deve ser invocada apenas via Supabase Cron com verificação do header de autorização interno.
- **Falta:** Não existe configuração de Cron no `config.toml` ou em qualquer migration. O agendamento precisa ser configurado manualmente no dashboard ou via CLI.

#### `sync-orders`
- **Pontos positivos:** Paginação, logging em sync_logs, tratamento de erro por integração sem parar o loop, rate limiting manual (100ms ML, 500ms Nuvemshop).
- **Problemas críticos:**
  - `fulfillment_type` no upsert de orders usa o nome de campo errado: o código usa `fulfillment_type` mas a tabela `orders` define a coluna como `fulfillment` (migration 00005, linha 50). O upsert vai falhar ou inserir NULL silenciosamente dependendo da configuração da tabela.
  - `marketplace_fee_percent` no upsert de orders: a coluna na tabela chama `marketplace_fee_pct` (migration 00005, linha 54). Mesmo problema — nome incorreto no código da Edge Function.
  - `order_items`: o upsert tenta inserir `marketplace_item_id` e `marketplace_fee`, mas a tabela `order_items` não tem essas colunas (migration 00005, linhas 102-114). O `onConflict: "order_id,marketplace_item_id"` vai falhar porque a constraint unique não existe nessa tabela.
- **Falta:** Não há lógica de reserva de estoque (`channel_stock.reserved`) quando um pedido entra com status `approved`.

#### `webhook-handler`
- **Pontos positivos:** Logs em sync_logs para cada webhook recebido, lookup por seller_id, tratamento de evento `orders_v2`.
- **Problemas:**
  - **Ausência total de validação de assinatura** no webhook do Mercado Livre. A ML assina webhooks com X-Signature. Sem verificar, qualquer requisição POST pode injetar dados falsos no banco.
  - Mesmo problema de nome de coluna do `sync-orders` (`fulfillment_type` vs `fulfillment`, `marketplace_fee_percent` vs `marketplace_fee_pct`).
  - O Nuvemshop webhook não valida o `hmac` que a Nuvemshop envia no header `X-Linkedstore-Hmac-Sha256`.
  - O `handleMLWebhook` não atualiza `customer_id`, `order_items`, `shipping_label_status`, `tracking_code` — apenas sobrescreve o mínimo.
  - Tópicos `payments`, `items`, `shipments` do ML são recebidos mas não processados — apenas logados.

#### `stripe-checkout`
- **Pontos positivos:** Autenticação via JWT, lookup do owner da org, criação de customer Stripe, upsert do `stripe_customer_id`.
- **Problema:** Não valida o `successUrl` e `cancelUrl` fornecidos pelo cliente — pode ser qualquer URL, permitindo open redirect em ambientes mal configurados. Recomendado validar contra a whitelist ou ignorar o parâmetro e usar URLs fixas.

#### `stripe-webhook`
- **Pontos positivos:** Verificação de assinatura com `constructEventAsync`, cobertura dos 5 eventos mais importantes do lifecycle de subscription.
- **Problema menor:** O fallback em `getPlanFromPriceId()` retorna `'starter'` para price IDs desconhecidos em vez de lançar um erro. Isso pode silenciosamente promover usuários para um plano incorreto se o `enterprise` price ID for adicionado sem atualizar essa função.

#### `_shared/cors.ts`
- **Problema:** Existe inconsistência entre `getCorsHeaders()` (usa whitelist com suporte a `*.vercel.app`) e o export `corsHeaders` (usa `FRONTEND_URL` com fallback para `"*"`). As funções `sync-orders`, `token-refresh` e `webhook-handler` usam o export `corsHeaders` com wildcard — em produção, isso expõe as funções a qualquer origem.

---

## 4. Problemas Críticos e SQL de Correção

### Correção CRITICO-01: Chicken-and-Egg em org_members_insert

O fluxo correto de criação de organização deve ser atômico: criar a org e inserir o primeiro membro (owner) em uma única operação privilegiada. A solução é criar uma função RPC `SECURITY DEFINER` que bypassa RLS, e chamar essa função do frontend no lugar de inserções diretas.

```sql
-- Migration 00012_fix_create_organization.sql

-- Remover policy problemática
DROP POLICY IF EXISTS org_members_insert ON org_members;

-- Nova policy: permite inserção se:
-- (a) usuário é admin/owner existente na org, OU
-- (b) o registro sendo inserido é do próprio usuário E a org foi criada há menos de 10 segundos
--     (janela de onboarding — owner inserindo a si mesmo)
CREATE POLICY org_members_insert ON org_members
  FOR INSERT WITH CHECK (
    user_has_role(organization_id, 'admin')
    OR (
      user_id = auth.uid()
      AND role = 'owner'
      AND EXISTS (
        SELECT 1 FROM organizations
        WHERE id = organization_id
          AND created_at > now() - interval '10 seconds'
      )
    )
  );

-- Alternativamente, a abordagem mais robusta é uma RPC SECURITY DEFINER:
CREATE OR REPLACE FUNCTION create_organization(
  org_name TEXT,
  org_slug TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id UUID;
  v_user_id UUID;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Criar organização
  INSERT INTO organizations (name, slug)
  VALUES (org_name, org_slug)
  RETURNING id INTO v_org_id;

  -- Inserir o criador como owner (bypassa RLS via SECURITY DEFINER)
  INSERT INTO org_members (organization_id, user_id, role, accepted_at)
  VALUES (v_org_id, v_user_id, 'owner', now());

  RETURN v_org_id;
END;
$$;

-- Revogar execução pública e conceder apenas a usuários autenticados
REVOKE EXECUTE ON FUNCTION create_organization FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_organization TO authenticated;
```

**Chamada no frontend:**
```javascript
// Substituir inserção direta por chamada RPC
const { data: orgId, error } = await supabase.rpc('create_organization', {
  org_name: 'Nome da Loja',
  org_slug: 'nome-da-loja'
});
```

---

### Correção CRITICO-02: Função `update_updated_at_column()` não existe

```sql
-- Opção A: Criar alias para a função existente (mínimo impacto)
-- Adicionar no início da migration 00011 ou criar migration 00012 separada

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
```

Ou, se preferir manter apenas uma função:

```sql
-- Opção B: Corrigir o nome no trigger da migration 00011
-- Substituir a linha do trigger por:
CREATE TRIGGER set_subscriptions_updated_at
  BEFORE UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();  -- nome correto
```

---

### Correção MEDIO-03: Nomes de colunas errados em sync-orders e webhook-handler

Os seguintes mapeamentos estão incorretos nas Edge Functions:

| Código (errado) | Tabela `orders` (correto) |
|---|---|
| `fulfillment_type` | `fulfillment` |
| `marketplace_fee_percent` | `marketplace_fee_pct` |
| `marketplace_item_id` (order_items) | coluna não existe |
| `marketplace_fee` (order_items) | coluna não existe |

**Opção A — Corrigir o código das Edge Functions** para usar os nomes corretos das colunas conforme definidos na migration 00005.

**Opção B — Adicionar as colunas faltantes em order_items via migration:**

```sql
-- Migration 00013_fix_order_items_columns.sql
ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS marketplace_item_id TEXT,
  ADD COLUMN IF NOT EXISTS marketplace_fee NUMERIC(12,2) DEFAULT 0;

-- Adicionar a constraint unique necessária para o onConflict do upsert
CREATE UNIQUE INDEX IF NOT EXISTS idx_order_items_order_marketplace
  ON order_items(order_id, marketplace_item_id)
  WHERE marketplace_item_id IS NOT NULL;
```

A Opção B é preferível pois preserva os dados de auditoria (ID do item no marketplace e taxa individual por item).

---

### Correção CRITICO-04: Validação de assinatura no webhook do Mercado Livre

O webhook-handler aceita qualquer POST sem verificar autenticidade. A ML usa assinatura HMAC-SHA256 no header `x-signature` com o formato `ts=TIMESTAMP,v1=HASH`.

```typescript
// Adicionar no início de handleMLWebhook():
async function verifyMLSignature(req: Request, body: string): Promise<boolean> {
  const secret = Deno.env.get("ML_WEBHOOK_SECRET");
  if (!secret) return false; // falha aberta se secret não configurado

  const sigHeader = req.headers.get("x-signature") ?? "";
  const tsMatch = sigHeader.match(/ts=(\d+)/);
  const v1Match = sigHeader.match(/v1=([a-f0-9]+)/);
  if (!tsMatch || !v1Match) return false;

  const ts = tsMatch[1];
  const receivedHash = v1Match[1];

  const dataId = new URL(req.url).searchParams.get("data.id") ?? "";
  const toSign = `id:${dataId};request-id:${req.headers.get("x-request-id") ?? ""};date-millis:${ts};`;

  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(toSign));
  const expectedHash = Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, "0")).join("");

  return expectedHash === receivedHash;
}
```

---

## 5. Requisitos Pendentes para Produção

### Prioridade 1 — Bloqueadores (sem isso o app não funciona em produção)

| # | Requisito | Descrição |
|---|---|---|
| P1-01 | Fix chicken-and-egg org_members | Conforme Seção 4 — sem isso nenhum usuário consegue criar organização |
| P1-02 | Fix update_updated_at_column() | Tabela subscriptions e stripe_invoices não são criadas sem isso |
| P1-03 | Fix nomes de colunas em sync-orders | fulfillment/marketplace_fee_pct — upsert de pedidos falha silenciosamente |
| P1-04 | Configurar variáveis de ambiente no Supabase Dashboard | STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_STARTER, STRIPE_PRICE_PRO, ML_APP_ID, ML_CLIENT_SECRET, ML_REDIRECT_URI, NUVEMSHOP_APP_ID, NUVEMSHOP_CLIENT_SECRET, FRONTEND_URL |
| P1-05 | Configurar webhook endpoint no Stripe Dashboard | Apontar para a URL da função stripe-webhook com os eventos: checkout.session.completed, customer.subscription.updated, customer.subscription.deleted, invoice.payment_succeeded, invoice.payment_failed |
| P1-06 | Configurar webhook no Mercado Livre Developer | Registrar URL da função webhook-handler para os tópicos orders_v2, payments, shipments |

### Prioridade 2 — Segurança (necessário antes de receber usuários reais)

| # | Requisito | Descrição |
|---|---|---|
| P2-01 | Assinar o OAuth state parameter | HMAC do state em marketplace-oauth para prevenir CSRF e org_id forjado |
| P2-02 | Validar assinatura webhook ML | Implementar verificação HMAC-SHA256 no webhook-handler |
| P2-03 | Validar assinatura webhook Nuvemshop | Verificar header X-Linkedstore-Hmac-Sha256 |
| P2-04 | Verificar ownership em marketplace-oauth/authorize | Validar que o usuário autenticado é membro admin da org_id recebida |
| P2-05 | Proteger token-refresh contra invocação externa | Adicionar verificação de Bearer token ou restringir a invocações internas do cron |
| P2-06 | Corrigir corsHeaders wildcard em _shared/cors.ts | Unificar uso de getCorsHeaders() em todas as funções |
| P2-07 | Criptografar access_token e refresh_token | Os tokens OAuth ficam em texto puro na tabela. Usar pg_crypto ou Supabase Vault para criptografia em repouso |

### Prioridade 3 — Funcionalidades Core (necessário para MVP completo)

| # | Requisito | Descrição |
|---|---|---|
| P3-01 | Suporte a Amazon na sync-orders | Hoje só ML e Nuvemshop estão implementados. Amazon requer SP-API com autenticação diferente |
| P3-02 | Suporte a Shopee na sync-orders | Shopee API requer HMAC nos headers de cada requisição |
| P3-03 | Reserva de estoque no sync-orders | Quando pedido entra como `approved`, incrementar `channel_stock.reserved` |
| P3-04 | Processamento de shipments no webhook-handler | Tópico `shipments` do ML não processa tracking_code nem atualiza shipping_label_status |
| P3-05 | Processamento de payments no webhook-handler | Tópico `payments` do ML não está sendo processado |
| P3-06 | Atualizar order_items no webhook-handler | handleMLWebhook não faz upsert de order_items, apenas do header do pedido |
| P3-07 | Configurar Supabase Cron | Agendar token-refresh a cada 30min e sync-orders a cada 15min via pg_cron |
| P3-08 | Função RPC de onboarding completo | Criar organização + inserir owner + seed de categorias em uma transação atômica |
| P3-09 | Endpoint para convidar membros | Atualmente org_members_insert com user_has_role='admin' existe, mas não há função/edge function para invite por email |
| P3-10 | Purga de sync_logs antigos | Sem política de DELETE e sem cron de limpeza, a tabela crescerá indefinidamente |

### Prioridade 4 — Funcionalidades de Negócio (pós-MVP)

| # | Requisito | Descrição |
|---|---|---|
| P4-01 | Módulo de emissão de NFe | Tabela e campos existem mas não há integração com SEFAZ/emissor (Focus NFe, eNotas, etc.) |
| P4-02 | Geração de etiquetas de envio | Campos existem mas não há integração com Correios/transportadoras |
| P4-03 | Repasses de marketplace (payouts) | Tabela existe mas sem edge function para importar dados de repasse do ML |
| P4-04 | Exportação de DRE/fluxo de caixa | Views existem mas sem endpoint para export em PDF/XLSX |
| P4-05 | Health Score calculator | Tabela existe mas não há função que calcula e persiste os scores periodicamente |
| P4-06 | Integração de ADS (custo de publicidade) | Campo `ads_cost` existe em daily_sales_metrics mas sem integração com ML Ads API |
| P4-07 | Amazon FBA inventory sync | Requer integração com SP-API Fulfillment Inventory endpoint |
| P4-08 | Gestão de planos com feature flags | Planos definidos na tabela subscriptions mas sem middleware que bloqueia features por plano |
| P4-09 | Suporte a enterprise no getPlanFromPriceId() | Fallback retorna 'starter' — adicionar enterprise ao mapeamento antes de criar esse plano |

---

## 6. Estado da Função `update_updated_at_column()` no Remoto

**Diagnóstico local:** A migration 00002 define `update_updated_at()`. A migration 00011 chama `update_updated_at_column()`. Essas são duas funções distintas. A segunda **não está definida em nenhuma migration local**.

**Possibilidades:**
1. A função foi criada manualmente no banco remoto (fora das migrations) — não há como confirmar sem acesso direto ao banco
2. A função nunca existiu e a migration 00011 nunca foi aplicada com sucesso no remoto
3. A função existe no remoto por ter sido copiada/criada manualmente em algum momento

**Verificação recomendada** (executar no SQL Editor do Supabase Dashboard):
```sql
SELECT proname, prosrc
FROM pg_proc
WHERE proname IN ('update_updated_at', 'update_updated_at_column')
AND pronamespace = 'public'::regnamespace;
```

Se `update_updated_at_column` não aparecer, a migration 00011 falhou e as tabelas `subscriptions` e `stripe_invoices` provavelmente não existem no remoto.

Verificar também:
```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name IN ('subscriptions', 'stripe_invoices');
```

---

## 7. Resumo Executivo

### O que está bem arquitetado
- Modelo multi-tenant com `organization_id` em todas as tabelas e funções auxiliares `get_user_org_ids()` / `user_has_role()` bem pensadas
- Triggers de recálculo automático de estoque e alertas
- Estrutura de sync_logs para auditoria e debug de integrações
- Flows de OAuth para ML e Nuvemshop presentes e funcionais conceitualmente
- Stripe webhook com verificação de assinatura correta
- Storage buckets com isolamento por org_id no path

### Problemas que impedem produção hoje
1. **CRITICO:** org_members_insert bloqueia criação de organização — nenhum usuário consegue se cadastrar
2. **CRITICO:** `update_updated_at_column()` faltante — subscriptions Stripe não funciona
3. **CRITICO:** Nomes de colunas errados em sync-orders — upsert de pedidos falha
4. **ALTO:** Webhooks sem validação de assinatura — risco de injeção de dados falsos
5. **ALTO:** OAuth state sem assinatura — risco de CSRF e org hijacking

### Próximos passos imediatos
1. Criar migration `00012_fix_create_organization.sql` com a RPC `create_organization()`
2. Criar migration `00013_fix_updated_at_alias.sql` com o alias da função
3. Criar migration `00014_fix_order_items_columns.sql` para adicionar `marketplace_item_id` e `marketplace_fee` em order_items
4. Corrigir `fulfillment_type` → `fulfillment` e `marketplace_fee_percent` → `marketplace_fee_pct` nas Edge Functions sync-orders e webhook-handler
5. Verificar no banco remoto se subscriptions/stripe_invoices existem
6. Configurar todas as variáveis de ambiente necessárias
