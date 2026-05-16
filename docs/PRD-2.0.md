# E-conomia — PRD 2.0: Refatoração Frontend & Remoção Supabase

> Versão: 2.0 | Data: 2026-05-04 | Status: EM DEFINIÇÃO

---

## 1. Conceito do Projeto

**E-conomia** é um ERP/WMS Lite para vendedores de e-commerce brasileiros, com foco inicial em Mercado Livre. O produto resolve três dores centrais:

1. **Visibilidade unificada de estoque** — Full, Flex e Próprio em um único painel
2. **Controle financeiro real** — margem por produto, taxas de marketplace, faturamento líquido
3. **Operação de armazém simplificada** — pedidos, picking, alertas inteligentes

### Stack Definitiva (pós-migração)

| Camada | Tecnologia | Onde roda |
|:---|:---|:---|
| **Backend** | Go 1.26 (chi v5, pgx v5) | Render Web Service |
| **Frontend** | Go HTML Templates + HTMX | Servido pelo Go |
| **Banco** | PostgreSQL puro | Render Postgres (Free → Starter) |
| **Auth** | Clerk (SDK Go v2) | SaaS (Free até 10k MAU) |
| **Cron Jobs** | `robfig/cron` embutido no Go | Mesmo processo |
| **Deploy** | `render.yaml` | Render (oregon) |

**O que foi removido:** Supabase (DB + Auth + Edge Functions + Realtime), Vercel, 25 Deno Edge Functions.

---

## 2. Diagnóstico do Frontend Atual

### 2.1 Problemas Identificados

| Problema | Impacto | Arquivos afetados |
|:---|:---|:---|
| CSS inline em `{{define "head"}}` por página | Estilo duplicado, impossível manter | dashboard.html, estoque.html, pedidos.html, vendas.html, contabil.html |
| JS inline em `{{define "scripts"}}` por página | Chart.js init duplicado, lógica espalhada | dashboard.html, estoque.html, vendas.html |
| Sem componentização de templates | kpi-card, data-table, badge refeitos por página | Todas as pages |
| Sidebar com dados hardcoded ("EC", "Admin") | Não reflete usuário real do Clerk | layouts/base.html |
| Chart.js via CDN externo | Latência extra, falha sem internet | dashboard.html |
| Nenhum estado de loading no HTMX | UX quebrada durante requests lentos | Todas as pages com `hx-get` |
| Nenhum template de erro global | Erros do servidor aparecem como página em branco | Todos os handlers |
| Nenhuma estrutura `components/` | Cada page é autossuficiente, zero reutilização | templates/ |

### 2.2 O que está bom e deve ser preservado

- `tokens.css` — design tokens (cores, espaçamento, tipografia) bem definidos
- `htmx.min.js` — local, sem CDN
- Padrão de layouts com `{{define "base"}}` + `{{block "content"}}`
- Navegação ativa via `{{if eq .PageTitle "X"}} active{{end}}`
- HTMX para partial updates (evita reloads completos)
- Dark/light theme via `localStorage`

---

## 3. Objetivos do PRD 2.0

### 3.1 Frontend (escopo principal)

**Goal 1 — Design System CSS em camadas**
```
static/css/
├── tokens.css         ← já existe (manter)
├── components.css     ← NOVO: .kpi-card, .data-table, .badge, .alert-banner, .btn variants
├── utilities.css      ← NOVO: .sr-only, .truncate, .loading-skeleton, .text-success/danger/warning
└── layout.css         ← NOVO: .sidebar, .main-content, .page-header (extrair do base inline)
```

**Goal 2 — Componentização dos Templates**
```
templates/
├── layouts/
│   └── base.html          ← limpar: remover CSS inline, user data real do Clerk
├── components/            ← NOVO diretório
│   ├── kpi-card.html      ← {{template "kpi-card" .}} com .Label, .Value, .Sub, .Trend
│   ├── data-table.html    ← {{template "data-table" .}} genérico com .Headers, .Rows
│   ├── badge.html         ← {{template "badge" .}} com .Color, .Label
│   ├── alert-banner.html  ← {{template "alert-banner" .}} com .Level (info/warn/error)
│   ├── loading.html       ← spinner + skeleton para HTMX
│   └── error.html         ← template de erro padronizado (500, 403, 404)
├── partials/              ← já existe (manter padrão)
└── pages/                 ← apenas lógica de composição
```

**Goal 3 — JS consolidado local**
```
static/js/
├── htmx.min.js            ← já existe
├── chart.min.js           ← NOVO: Chart.js local (baixar, não CDN)
└── app.js                 ← NOVO: theme toggle, HTMX loading indicators, tab helpers
```

**Goal 4 — User data real no sidebar**
- Sidebar exibe nome e avatar do usuário logado (via Clerk session)
- Role exibe "Admin" / "Operador" a partir do Clerk organization role
- Handler `base.html` recebe `TemplateData.User` com `Name`, `AvatarURL`, `Role`

**Goal 5 — HTMX UX completa**
- `hx-indicator` em todos os botões e requests
- `hx-confirm` em ações destrutivas
- Respostas de erro do servidor retornam `{{template "alert-banner"}}` em vez de 500 puro

### 3.2 Remoção Supabase (escopo de infraestrutura)

**Goal 6 — Migrar Edge Functions para Go handlers**

As 25 Edge Functions em `supabase/functions/` viram handlers Go em `internal/handlers/`:

| Edge Function (Deno) | Destino Go | Prioridade |
|:---|:---|:---|
| `marketplace-oauth` | `handlers/marketplace_oauth.go` | ✅ Já existe (mercadolivre.go) |
| `marketplace-callback` | `handlers/marketplace_callback.go` | ✅ Já existe |
| `webhook-handler` | `handlers/webhooks.go` | ✅ Já existe |
| `reconcile-stock` | `jobs/stock_reconcile.go` | ✅ Já existe |
| `token-refresh` | `jobs/token_refresh.go` | ✅ Já existe |
| `push-stock-to-ml` | `handlers/stock_push.go` | 🔲 Pendente |
| `sync-orders` | `handlers/order_sync.go` | 🔲 Pendente |
| `sync-inventory` | `handlers/inventory_sync.go` | 🔲 Pendente |
| `check-stock-alerts` | `jobs/stock_alerts.go` | 🔲 Pendente |
| `scheduled-report` | `jobs/scheduled_report.go` | 🔲 Pendente |
| `create-payment-link` | `handlers/payment.go` | 🔲 Pendente (Fase 3) |
| `emit-nfe` | `handlers/nfe.go` | 🔲 Pendente (Fase 4) |
| `erp-sync` | `handlers/erp_sync.go` | Parcialmente (omie.go, olist_hub.go) |
| `ai-chat` | Remover ou Fase 5 | Baixa prioridade |
| `stripe-checkout`, `stripe-webhook` | `handlers/billing.go` | Quando monetizar |

**Goal 7 — Migrar Schema Postgres**

Migração já documentada em `migration-to-golang-implementation_plan.md`. Resumo das mudanças necessárias nas SQLs:

```sql
-- Remover referências Supabase
REFERENCES auth.users(id)          → TEXT (Clerk user_id)
auth.uid()                         → parâmetro Go injetado pelo middleware
get_user_org_ids()                 → WHERE org_id = $1 no handler Go
```

Migrations RLS a remover: `00008`, `00012` (multi-tenancy via middleware Go).

---

## 4. Páginas — Estado e Escopo

| Página | Rota | Estado | Escopo PRD 2.0 |
|:---|:---|:---|:---|
| Login | `/login` | ✅ Funcional | Apenas visual polish |
| Dashboard | `/dashboard` | ✅ Funcional | Refatorar CSS inline → components.css, Chart.js local |
| Estoque | `/estoque` | ✅ Funcional | Extrair data-table component |
| Pedidos | `/pedidos` | ✅ Funcional | Extrair data-table, adicionar HTMX indicators |
| Vendas | `/vendas` | ✅ Funcional | Extrair filtros como partial, Chart.js local |
| Marketplaces | `/marketplaces` | ✅ Funcional | Visual polish |
| Contábil | `/contabil` | 🔲 Em desenvolvimento | Implementar + usar components prontos |
| Settings | `/settings` | ✅ Funcional | User data real, OAuth status |
| Erro 404/500 | `/error` | 🔲 Ausente | Criar templates padronizados |

---

## 5. Fases de Implementação

### Fase A — Foundation CSS (1-2 dias)
- [ ] Criar `static/css/components.css` — definir classes de todos os componentes
- [ ] Criar `static/css/utilities.css` — helpers de texto, loading skeleton
- [ ] Criar `static/css/layout.css` — extrair sidebar/header do base.html
- [ ] Remover CSS inline de todas as pages (migrar para classes)
- [ ] Baixar Chart.js para `static/js/chart.min.js`
- [ ] Criar `static/js/app.js` — theme toggle + HTMX loading indicators

### Fase B — Template Components (2-3 dias)
- [ ] Criar `templates/components/` com: kpi-card, data-table, badge, alert-banner, loading, error
- [ ] Refatorar `layouts/base.html` — user data real do Clerk, remover hardcoded
- [ ] Refatorar `pages/dashboard.html` — usar kpi-card, Chart.js local, remover inline CSS/JS
- [ ] Refatorar `pages/estoque.html` — usar data-table component
- [ ] Refatorar `pages/pedidos.html` — usar data-table + HTMX indicators
- [ ] Refatorar `pages/vendas.html` — usar components + extrair JS
- [ ] Criar `pages/error.html` — 404 e 500 padronizados

### Fase C — HTMX UX (1 dia)
- [ ] Adicionar `hx-indicator` em todos os `hx-get`/`hx-post`
- [ ] Adicionar `hx-confirm` em ações de deleção/reset
- [ ] Handlers Go retornam `alert-banner` component em erros (não 500 puro)
- [ ] Loading skeleton nos partials que fazem polling (`hx-trigger="every 30s"`)

### Fase D — Contábil + Edge Functions (2-3 dias)
- [ ] Finalizar `pages/contabil.html` usando components da Fase B
- [ ] Implementar `handlers/stock_push.go` (substitui push-stock-to-ml)
- [ ] Implementar `handlers/order_sync.go` (substitui sync-orders)
- [ ] Implementar `jobs/stock_alerts.go` (substitui check-stock-alerts)
- [ ] Implementar `jobs/scheduled_report.go`

### Fase E — Schema Cleanup (1 dia)
- [ ] Criar migration `00029_remove_supabase_refs.sql` — limpar RLS, auth.uid(), profiles
- [ ] Testar schema completo em Render Postgres
- [ ] Remover diretório `supabase/functions/` do repositório

---

## 6. Padrão de Componente Go Template

### Uso

```html
<!-- Em qualquer page -->
{{template "kpi-card" map "Label" "Faturamento bruto" "Value" .KPIs.Revenue "Sub" .KPIs.Variation "Trend" "up"}}
```

### Definição (templates/components/kpi-card.html)

```html
{{define "kpi-card"}}
<div class="kpi-card">
  <p class="kpi-label">{{.Label}}</p>
  <p class="kpi-value">{{.Value}}</p>
  {{if .Sub}}<p class="kpi-sub {{if eq .Trend "up"}}text-success{{else if eq .Trend "down"}}text-danger{{end}}">{{.Sub}}</p>{{end}}
</div>
{{end}}
```

### Helper `map` no Go

```go
// internal/handlers/template_helpers.go
func templateHelpers() template.FuncMap {
    return template.FuncMap{
        "map": func(kvs ...any) map[string]any {
            m := make(map[string]any, len(kvs)/2)
            for i := 0; i < len(kvs)-1; i += 2 {
                m[fmt.Sprint(kvs[i])] = kvs[i+1]
            }
            return m
        },
    }
}
```

---

## 7. Decisões Arquiteturais

| Decisão | Escolha | Justificativa |
|:---|:---|:---|
| **Banco** | Render PostgreSQL (nativo) | Já configurado em render.yaml, sem overhead de SDK |
| **Auth** | Clerk (manter) | Free, multi-tenancy nativo, SDK Go maduro |
| **Frontend rendering** | Server-side (Go templates) | Zero JS build, sem node_modules, deploy simples |
| **Interatividade** | HTMX | Partials server-rendered, sem estado client-side |
| **Charts** | Chart.js local (não CDN) | Disponibilidade offline, sem latência de terceiros |
| **CSS** | Vanilla CSS com tokens | Sem dependência de build, tokens já definidos |
| **ERP integrations** | Omie + Olist Hub | Drivers já existem, Go puro |
| **Marketplace** | Mercado Livre (foco) | OAuth + webhooks já implementados |

---

## 8. Métricas de Sucesso

| Métrica | Baseline | Meta |
|:---|:---|:---|
| CSS inline por página | ~80 linhas/página | 0 linhas (tudo em components.css) |
| JS inline por página | ~50 linhas/página | 0 linhas (tudo em app.js) |
| Componentes reutilizáveis | 0 | 6+ (kpi-card, data-table, badge, alert, loading, error) |
| Tempo de resposta P95 | ~200ms (Supabase) | <10ms (Go direto no Postgres) |
| Edge Functions remanescentes | 25 | 0 (tudo em Go) |
| Custo mensal infraestrutura | ~$25 (Supabase Pro) | $0-7 (Render Free/Starter) |

---

## 9. Fora do Escopo (PRD 2.0)

- Landing page / cadastro freemium (ECOM-96) — PRD separado
- Barcode/QR scanning (ECOM-85/86) — Fase 5
- Stripe billing — quando monetizar
- NFe emission — integração ERP, Fase 4
- Mobile app — não planejado

---

## Referências

- [PRD 1.0](./PRD.md) — requisitos originais e fases de produto
- [Plano de Migração Go](../migration-to-golang-implementation_plan.md) — detalhes de schema e Edge Functions
- [render.yaml](../economia-go/render.yaml) — configuração de infraestrutura
- [Linear Board](https://linear.app/devops-dreamsquad/team/ECOM/backlog)
