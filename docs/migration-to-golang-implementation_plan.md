# Plano de Refatoração: E-conomia → Go + HTMX + PostgreSQL (Render)

Migração completa da plataforma E-conomia de **Supabase + HTML/JS estático** para um **monolito Go** com HTMX, PostgreSQL puro no Render, e autenticação via Clerk.

---

## 1. Contexto & Motivação

### Stack Atual vs. Novo

| Aspecto | Atual | Novo |
|:---|:---|:---|
| **DB** | Supabase (PostgreSQL gerenciado) | PostgreSQL no Render (free → pro) |
| **Backend** | 25 Edge Functions (TypeScript/Deno) | Go HTTP Handlers (chi router) |
| **Frontend** | 12 páginas HTML + Vanilla JS + Supabase Client | Go Templates (templ) + HTMX |
| **Auth** | Supabase Auth (GoTrue) | Clerk (SDK Go) |
| **Hosting** | Vercel (estático) + Supabase (functions) | Render (binário Go + PostgreSQL) |
| **Multi-tenancy** | RLS via `auth.uid()` + `get_user_org_ids()` | Middleware Go (org context injection) |
| **Custo mensal** | ~$25 (Supabase Pro) + Vercel | $0 (Render Free) → $7 (Starter) |

### Por que migrar?

1. **Performance:** Go responde em ~2ms vs ~200ms das Edge Functions. Para um ERP com tabelas pesadas, isso é transformador.
2. **Simplicidade:** Um binário. Sem 25 functions separadas, sem build step JS, sem CDN de terceiros.
3. **Custo:** Render Free + Clerk Free = $0/mês para começar.
4. **Controle:** PostgreSQL puro sem a camada de abstração do Supabase (RLS, realtime, etc).

---

## 2. Decisões de Arquitetura

### 2.1 Autenticação: Clerk

| Decisão | Justificativa |
|:---|:---|
| **Clerk** (não sessões nativas) | Free até 10k MAU. Login social (Google, GitHub), MFA, user management pronto. SDK Go oficial. Evita reinventar auth. |
| **Fluxo:** | Clerk hospeda a tela de login. Redireciona para `/dashboard` com session cookie. Middleware Go valida a sessão em cada request. |
| **Multi-tenancy:** | Clerk tem o conceito de "Organizations" nativo. Cada seller = 1 Clerk Organization. O middleware injeta o `orgID` no context. |

### 2.2 Banco de Dados: Migração do Schema

> [!IMPORTANT]
> **As 28 migrations SQL existentes são 95% reutilizáveis.** As únicas mudanças necessárias são:

| Mudança | Motivo |
|:---|:---|
| Remover `REFERENCES auth.users(id)` | Não teremos `auth.users` do Supabase. Substituir por `TEXT` (Clerk user ID = `user_xxxxx`). |
| Remover `auth.uid()` das functions/triggers | Substituir por parâmetro explícito do handler Go. |
| Remover toda a migration `00008_rls_policies.sql` | RLS não será usado — multi-tenancy via middleware Go com `WHERE organization_id = $1`. |
| Remover `00012_fix_rls_create_organization.sql` | Idem. |
| Adaptar `profiles` | Clerk gerencia perfis. A tabela `profiles` pode ser simplificada para dados extras (preferências). |

**Tabelas que migram SEM mudanças:**
- `organizations`, `org_members` (trocar FK de `auth.users` para `TEXT`)
- `marketplace_integrations`, `sync_logs`
- `suppliers`, `products`, `channel_stock`, `stock_movements`
- `customers`, `orders`, `order_items`
- `expense_categories`, `expenses`, `cash_flow_entries`, `marketplace_payouts`
- `stock_locations`, `warehouse_locations`
- `erp_status_mapping`, `erp_sync_logs` (nova 00028)
- Todas as views (`v_monthly_financial_summary`, `v_monthly_expenses`)
- Todos os triggers de cálculo automático (estoque, customer stats)

### 2.3 Multi-Tenancy: Middleware Go (Substitui RLS)

```go
// Antes (Supabase RLS):
// SELECT * FROM products WHERE organization_id IN (SELECT get_user_org_ids())

// Depois (Go middleware):
func OrgMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        claims := clerk.SessionClaimsFromContext(r.Context())
        orgID := claims.ActiveOrganizationID
        ctx := context.WithValue(r.Context(), "orgID", orgID)
        next.ServeHTTP(w, r.WithContext(ctx))
    })
}

// Em cada handler:
func (h *Handler) Dashboard(w http.ResponseWriter, r *http.Request) {
    orgID := r.Context().Value("orgID").(string)
    kpis, _ := h.db.GetDashboardKPIs(ctx, orgID)  // WHERE organization_id = $1
}
```

### 2.4 Frontend: HTMX Patterns

O frontend atual carrega dados via `fetch()` → JS manipula DOM. Com HTMX, o servidor retorna HTML pronto.

**Padrão atual (JS):**
```javascript
// dashboard.html
const products = await fetchInventoryPreview(orgId, 10);
renderInventory(products); // manipula innerHTML manualmente
```

**Padrão novo (HTMX):**
```html
<!-- dashboard.templ -->
<div id="inventory-alerts"
     hx-get="/partials/stock-alerts"
     hx-trigger="load, every 30s"
     hx-swap="innerHTML">
    <div class="skeleton" style="height:200px"></div>
</div>
```

**Mapeamento completo de interações:**

| Interação Atual (JS) | Equivalente HTMX |
|:---|:---|
| `fetchDashboardKPIs()` → render DOM | `hx-get="/partials/dashboard/kpis"` server-rendered |
| `changeMarketplace('ml', this)` | `hx-get="/partials/dashboard/kpis?mp=mercado_livre"` + `hx-target="#kpi-grid"` |
| `fetchAllInventory(orgId, {search, filter})` | `hx-get="/partials/estoque/table?search=X&filter=critical"` |
| `Chart.js` (faturamento 12 meses) | **Mantém Chart.js** — dados injetados via `<script>` no template |
| `signOut()` | `<form method="POST" action="/auth/logout">` |
| `supabase.from('orders').select(...)` | Handler Go faz a query, retorna HTML partial |

### 2.5 CSS: Reutilização Total

> [!TIP]
> O arquivo `tokens.css` (472 linhas) é 100% reutilizável. Ele define design tokens via CSS custom properties, sem nenhuma dependência do Supabase. Copia direto para `static/css/tokens.css`.

---

## 3. Estrutura do Projeto Go

```
economia-go/
├── cmd/server/
│   └── main.go                    ← chi router, Clerk middleware, serve static
├── internal/
│   ├── config/config.go           ← DATABASE_URL, CLERK_SECRET, ML_CLIENT_ID, etc
│   ├── db/
│   │   ├── pool.go                ← pgxpool.New(ctx, DATABASE_URL)
│   │   ├── queries.sql.go         ← sqlc-generated
│   │   └── queries.sql            ← Raw SQL queries para sqlc
│   ├── handlers/
│   │   ├── dashboard.go           ← GET /dashboard (full page)
│   │   ├── estoque.go             ← GET /estoque (full page)
│   │   ├── pedidos.go             ← GET /pedidos
│   │   ├── vendas.go              ← GET /vendas
│   │   ├── contabil.go            ← GET /contabil
│   │   ├── settings.go            ← GET /settings
│   │   └── partials/
│   │       ├── kpis.go            ← GET /partials/dashboard/kpis (HTMX partial)
│   │       ├── stock_table.go     ← GET /partials/estoque/table (HTMX partial)
│   │       └── stock_alerts.go    ← GET /partials/stock-alerts
│   ├── drivers/
│   │   ├── mercadolivre.go        ← OAuth, Stock Push, Webhooks
│   │   ├── olist_hub.go           ← Partners API (fulfillment)
│   │   ├── omie.go                ← JSON-RPC (fulfillment)
│   │   ├── shopee.go              ← HMAC Auth
│   │   └── amazon.go              ← SP-API
│   ├── middleware/
│   │   ├── auth.go                ← Clerk session → context
│   │   ├── org.go                 ← orgID injection
│   │   └── logging.go             ← Request logging
│   ├── models/                    ← Go structs (mapeiam tabelas)
│   │   ├── organization.go
│   │   ├── product.go
│   │   ├── order.go
│   │   └── integration.go
│   └── jobs/
│       ├── scheduler.go           ← robfig/cron setup
│       ├── token_refresh.go       ← Cron: refresh OAuth tokens
│       └── stock_reconcile.go     ← Cron: reconciliação de estoque
├── templates/
│   ├── layouts/base.templ         ← Sidebar + Header + Body wrapper
│   ├── components/
│   │   ├── sidebar.templ
│   │   ├── kpi_card.templ
│   │   ├── table.templ
│   │   ├── badge.templ
│   │   └── toast.templ
│   └── pages/
│       ├── dashboard.templ
│       ├── estoque.templ
│       ├── pedidos.templ
│       ├── vendas.templ
│       ├── contabil.templ
│       └── settings.templ
├── static/
│   ├── css/tokens.css             ← Cópia exata do design system atual
│   ├── js/
│   │   ├── htmx.min.js           ← 14KB
│   │   ├── chart.umd.min.js      ← Chart.js (para gráficos)
│   │   └── theme.js              ← Dark/light toggle (4 linhas)
│   └── assets/logos/              ← Logos dos marketplaces
├── migrations/                    ← .sql adaptados (sem RLS, sem auth.users)
│   ├── 001_enums.sql
│   ├── 002_core_tables.sql
│   ├── ...
│   └── 028_erp_integrations.sql
├── render.yaml
├── go.mod
├── go.sum
└── sqlc.yaml
```

---

## 4. Plano de Execução (Faseado)

### 🟢 Fase 1: Foundation + Dashboard + Estoque (2 semanas)

**Objetivo:** App funcionando no Render com login Clerk, Dashboard e Estoque reais.

| # | Task | Detalhes |
|---|:---|:---|
| 1.1 | `go mod init` + dependências | chi, pgx, templ, clerk-sdk-go, cron |
| 1.2 | Adaptar migrations SQL | Remover `auth.users` FK, remover RLS, ajustar triggers |
| 1.3 | `render.yaml` + PostgreSQL free | Web service Go + DB addon |
| 1.4 | `cmd/server/main.go` | Router chi, Clerk middleware, static files |
| 1.5 | `internal/db/pool.go` | Connection pool pgxpool |
| 1.6 | `templates/layouts/base.templ` | Layout base com sidebar (converter de HTML) |
| 1.7 | `templates/pages/dashboard.templ` | KPIs + Chart.js + Tabs MP + Estoque em alerta |
| 1.8 | `templates/pages/estoque.templ` | Tabela filtrada + multi-canal + HTMX search |
| 1.9 | `handlers/dashboard.go` + partials | Queries reais, render server-side |
| 1.10 | `handlers/estoque.go` + partials | Queries com filtro, paginação server-side |
| 1.11 | Clerk setup | Criar app no Clerk, configurar redirect URLs |
| 1.12 | Deploy no Render | Push no branch → auto-deploy |

### 🟡 Fase 2: Pedidos, Vendas, Fulfillment (2 semanas)

| # | Task |
|---|:---|
| 2.1 | `handlers/pedidos.go` + template |
| 2.2 | `handlers/vendas.go` + template |
| 2.3 | `drivers/olist_hub.go` (push pedidos) |
| 2.4 | `drivers/omie.go` (JSON-RPC) |
| 2.5 | `handlers/webhooks.go` (recebe ML/Olist/Omie) |
| 2.6 | `jobs/stock_reconcile.go` (cron) |

### 🔵 Fase 3: Contábil, Settings, OAuth, NFe (2 semanas)

| # | Task |
|---|:---|
| 3.1 | `handlers/contabil.go` + template |
| 3.2 | `handlers/settings.go` + template (integrações) |
| 3.3 | `drivers/mercadolivre.go` (OAuth completo) |
| 3.4 | `drivers/shopee.go` + `drivers/amazon.go` |
| 3.5 | `handlers/nfe.go` + `handlers/labels.go` |
| 3.6 | `jobs/token_refresh.go` (cron) |

### ⚪ Fase 4: Landing, AI, Billing (1 semana)

| # | Task |
|---|:---|
| 4.1 | Landing page (marketing) |
| 4.2 | AI Chat widget |
| 4.3 | Stripe Billing integration |

---

## 5. Render Deploy Config

```yaml
services:
  - type: web
    name: economia-app
    runtime: go
    region: oregon
    plan: free
    buildCommand: |
      go install github.com/a-h/templ/cmd/templ@latest
      templ generate
      go build -o bin/server ./cmd/server
    startCommand: ./bin/server
    healthCheckPath: /healthz
    envVars:
      - key: DATABASE_URL
        fromDatabase:
          name: economia-db
          property: connectionString
      - key: CLERK_SECRET_KEY
        sync: false
      - key: CLERK_PUBLISHABLE_KEY
        sync: false
      - key: ML_CLIENT_ID
        sync: false
      - key: ML_CLIENT_SECRET
        sync: false
      - key: OLIST_CLIENT_ID
        sync: false
      - key: OLIST_CLIENT_SECRET
        sync: false
      - key: OMIE_APP_KEY
        sync: false
      - key: OMIE_APP_SECRET
        sync: false
      - key: ENCRYPTION_KEY
        sync: false

databases:
  - name: economia-db
    plan: free
    databaseName: economia
    user: economia_user
    region: oregon
```

---

## 6. Plano de Verificação

### Automatizado
- `go test ./...` — Testes unitários em handlers e drivers.
- `go vet` + `staticcheck` — Análise estática.
- `hey -n 1000 -c 50 https://economia-app.onrender.com/dashboard` — Load test.

### Manual
- Comparar visualmente Dashboard Go vs Dashboard atual (mesma CSS).
- Testar login Clerk → redirect → Dashboard com dados reais.
- Testar filtro HTMX de estoque (search + filter por status).

### Métricas de Sucesso
| Métrica | Atual (Supabase) | Alvo (Go) |
|:---|:---|:---|
| TTFB Dashboard | ~800ms | <100ms |
| Tamanho JS carregado | ~200KB | ~30KB (htmx + chart.js) |
| Deploy time | ~45s (Vercel) | ~30s (Render Go build) |
| Custo mensal | ~$25 | $0 (free tier) |
