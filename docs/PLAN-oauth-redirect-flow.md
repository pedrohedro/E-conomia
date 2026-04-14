# PLAN-oauth-redirect-flow.md
# Correção do Fluxo OAuth — Todos os Marketplaces

**Data:** 2026-04-14  
**Issues:** ECOM-51 a ECOM-55 (OAuth bug)  
**Status:** AGUARDANDO APROVAÇÃO

---

## 🔍 Diagnóstico do Problema

### O que deve acontecer (padrão correto — igual ao ML):
```
1. Usuário clica "Conectar"
2. Browser REDIRECIONA para a Edge Function (GET) no Supabase
3. Edge Function computa URL de auth com secrets (nunca expostos ao browser)
4. Edge Function faz HTTP 302 → marketplace OAuth page
5. Usuário autoriza na plataforma
6. Marketplace faz callback → Edge Function /marketplace-callback?marketplace=xxx&code=xxx
7. Edge Function troca code por token, salva no DB
8. Edge Function redireciona → app /?connected=xxx
```

### O que está acontecendo agora (ERRADO):
```
1. Usuário clica "Conectar"
2. Frontend faz POST para Edge Function
3. Edge Function retorna JSON { auth_url: "..." }
4. Frontend faz window.location.href = data.auth_url  ← PROBLEMA AQUI
   - auth_url nunca é aberta porque muitos requests falham (auth bloqueado)
   - Assinatura Shopee usa timestamp → pode expirar entre POST e redirect
   - Secrets são retornados parcialmente para o frontend
```

---

## 📐 Arquitetura Proposta

```
Frontend (index.html)
  onclick → window.location.href = SUPABASE_FUNCTIONS/marketplace-authorize?marketplace=xxx&org_id=xxx&token=xxx
                                                                ↓ GET (302 redirect)
                                          marketplace OAuth page (Shopee/Amazon/Bling/Shopify/TikTok)
                                                                ↓ callback
SUPABASE_FUNCTIONS/marketplace-callback?marketplace=xxx&code=xxx&state=xxx
                                                                ↓
                                          DB: upsert marketplace_integrations
                                                                ↓ 302 redirect
                                          APP_URL/?connected=shopee (or ?error=xxx)
```

---

## 🗺️ OAuth Específico por Marketplace

### 1. Shopee Open Platform
- **Auth URL:** `https://partner.shopeemobile.com/api/v2/shop/auth_partner`
  - Params: `partner_id`, `timestamp`, `sign` (HMAC-SHA256), `redirect`
  - O `sign` deve ser calculado **no momento do redirect** (timestamp-sensitive)
  - ✅ Precisa ser feito no Edge Function (server-side)
- **Callback params:** `?code=xxx&shop_id=xxx` (sem `state`)
- **Token exchange:** POST `/api/v2/auth/token/get`

### 2. Amazon SP-API (Login with Amazon)
- **Auth URL:** `https://sellercentral.amazon.com.br/apps/authorize/consent?application_id=APP_ID&state=xxx`
  - Simples — só precisa do `application_id` e `state`
- **Callback params:** `?spapi_oauth_code=xxx&state=xxx&selling_partner_id=xxx&mws_auth_token=xxx`
- **Token exchange:** POST `https://api.amazon.com/auth/o2/token`

### 3. Bling ERP v3
- **Auth URL:** `https://www.bling.com.br/OAuth2/Auth?response_type=code&client_id=CLIENT_ID&state=xxx`
- **Callback params:** `?code=xxx&state=xxx`
- **Token exchange:** POST `https://www.bling.com.br/OAuth2/Api/Access` (Basic Auth: base64(client_id:secret))

### 4. Shopify
- **Auth URL:** `https://{shop}/admin/oauth/authorize?client_id=xxx&scope=xxx&redirect_uri=xxx&state=xxx`
  - Requer o domínio da loja (`shop`) do usuário → pergunto antes do redirect
- **Callback params:** `?code=xxx&hmac=xxx&shop=xxx&state=xxx&timestamp=xxx`
  - **⚠️ CRÍTICO:** Verificar HMAC antes de aceitar o callback
- **Token exchange:** POST `https://{shop}/admin/oauth/access_token`

### 5. TikTok Shop
- **Auth URL:** `https://auth.tiktok-shops.com/oauth/authorize?app_key=xxx&state=xxx&response_type=code`
- **Callback params:** `?code=xxx&state=xxx`
- **Token exchange:** GET `https://auth.tiktok-shops.com/api/v2/token/get`

---

## 📁 Arquivos a Criar/Modificar

### [NEW] `supabase/functions/marketplace-authorize/index.ts`
Edge Function GET que:
1. Lê `?marketplace=xxx&org_id=xxx&token=xxx` (token = Supabase JWT do usuário)
2. Valida o JWT via service client
3. Gera `state = base64(org_id:user_id:timestamp)`, salva em `oauth_states` table
4. Computa a auth URL com secrets (server-side)
5. Retorna **HTTP 302** → URL de auth do marketplace

### [NEW] `supabase/functions/marketplace-callback/index.ts`
Edge Function GET que:
1. Lê `?marketplace=xxx&code=xxx&state=xxx` (+ params específicos por marketplace)
2. Para Shopify: verifica HMAC
3. Valida `state` contra `oauth_states` table (anti-CSRF)
4. Troca `code` por `access_token` (server-side, usando secrets)
5. Salva integração no DB
6. Retorna **HTTP 302** → `APP_URL/?connected=marketplace` ou `?error=msg`

### [MODIFY] `public/index.html`
Botões "Conectar" passam a usar `window.location.href` direto:
```javascript
window.handleConnect = function(marketplace) {
  const token = (await supabase.auth.getSession()).data.session.access_token;
  window.location.href = `${SUPABASE_FN}/marketplace-authorize?marketplace=${marketplace}&org_id=${orgId}&token=${token}`;
};
```
Para Shopify, adiciona prompt do shop antes do redirect.

### [NEW] `supabase/migrations/00018_oauth_states.sql`
Tabela `oauth_states` para validação anti-CSRF:
```sql
create table oauth_states (
  state text primary key,
  org_id uuid,
  user_id uuid,
  marketplace text,
  shop text,  -- só Shopify
  created_at timestamptz default now(),
  expires_at timestamptz default now() + interval '10 minutes'
);
```

### [MODIFY] `vercel.json`
Adiciona rota `/oauth/callback` → `oauth-callback.html` (página intermediária de loading)

### [NEW] `public/oauth-callback.html`
Página estática de loading que não faz nada — o redirect final da Edge Function
já leva direto para `/?connected=marketplace`.

---

## 🔐 Segurança

| Requisito | Implementação |
|-----------|---------------|
| Secrets nunca expostos | Auth URL gerada server-side na Edge Function |
| CSRF protection | `state` token validado via `oauth_states` table |
| Shopify HMAC | Verificado no callback antes de qualquer ação |
| Token expirado | `oauth_states` expira em 10 minutos |
| JWT validation | Usuário validado antes de generar state |

---

## ✅ Verificação

1. Clicar "Conectar Shopee" → abre Shopee Open Platform login
2. Clicar "Conectar Amazon" → abre Seller Central Brasil
3. Clicar "Conectar Bling" → abre Bling OAuth
4. Clicar "Conectar Shopify" → prompt shop → abre Shopify OAuth
5. Clicar "Conectar TikTok Shop" → abre TikTok Partner auth

---

## 🕐 Estimativa

| Tarefa | Tempo |
|--------|-------|
| Migration oauth_states | 10min |
| marketplace-authorize Edge Function | 30min |
| marketplace-callback Edge Function | 40min |
| Frontend (botões + Shopify prompt) | 20min |
| **Total** | **~1h40min** |
