# E-conomia CRM

CRM e gestão de estoque multi-marketplace para e-commerce, com foco inicial em Mercado Livre. Arquitetura serverless sobre Supabase + Vercel + Render Worker.

## Stack

| Camada | Tecnologia |
|---|---|
| Frontend | HTML estático + ESM JS (sem framework), servido via Vercel |
| Backend | Supabase — Postgres + Auth + Realtime + Storage |
| Edge Functions | Deno (Supabase Edge Functions) |
| Filas / Background jobs | `graphile-worker` em Render Worker (Node) |
| Pagamentos | Stripe (subscriptions + checkout) |
| Integrações | Mercado Livre, Amazon, Shopee, Nuvemshop |

## Estrutura

```
.
├── public/                # Frontend estático (Vercel deploys this)
│   ├── *.html             # Páginas (dashboard, vendas, estoque, etc.)
│   ├── js/                # Módulos ESM (api, auth-guard, supabase-client...)
│   ├── css/               # Stylesheets
│   └── assets/            # Logos e imagens
├── supabase/
│   ├── migrations/        # SQL versionado (00001_*.sql ... )
│   ├── functions/         # Edge Functions (Deno)
│   ├── seed/              # Dados de seed
│   └── config.toml
├── render-worker/         # Graphile Worker (filas) para Render.com
├── scripts/debug/         # Scripts utilitários de debug (Python)
├── tests/
│   ├── manual/            # Smoke tests manuais (Playwright Python)
│   └── screenshots/       # Snapshots de validação visual
├── docs/                  # PRD, arquitetura, planos, custos
├── vercel.json            # Roteamento + headers (CSP)
└── render.yaml            # Worker deploy config
```

## Setup local

```bash
# 1. Variáveis
cp .env.example .env
# preencha SUPABASE_URL, SUPABASE_ANON_KEY, etc.

# 2. Instalar Supabase CLI
brew install supabase/tap/supabase

# 3. Subir frontend local
npm run dev    # serve public/ em http://localhost:3000
```

## Comandos

```bash
npm run dev                  # serve public/ em :3000
npm run build                # no-op (site estático)
npm run supabase:migrate     # aplica migrations no projeto remoto
npm run supabase:types       # gera tipos TS do schema
npm run deploy:functions     # deploy de todas as Edge Functions
```

## Deploy

- **Frontend (Vercel):** push em `main` dispara deploy automático. Output dir = `public/`.
- **Edge Functions (Supabase):** `npm run deploy:functions`.
- **Render Worker:** `render.yaml` no root; deploy via Render dashboard ou Git push.

## Convenções

- Migrations seguem padrão `NNNNN_descricao.sql` em ordem numérica — não reordenar.
- RLS habilitado em todas as tabelas; policies revisadas em `00008_rls_policies.sql` e correções subsequentes.
- Tokens de marketplace criptografados (ver `00024_secure_tokens.sql`).
- Webhooks ML: pg_net + queue (ver `00025_webhook_queue.sql`, `00027_trigger_push_stock_ml.sql`).
- Identificadores Linear: `ECOM-XX` (ver `docs/PRD.md`).

## Documentação

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — visão completa do backend
- [`docs/PRD.md`](docs/PRD.md) — requisitos de produto
- [`docs/PLAN-estoque-ml.md`](docs/PLAN-estoque-ml.md) — plano de sync de estoque ML
- [`docs/sugestoes-melhorias.md`](docs/sugestoes-melhorias.md) — recomendações técnicas
- [`docs/custos-operacionais.md`](docs/custos-operacionais.md) — custos do stack

## Segurança

- Nunca commitar `.env` ou credenciais (já no `.gitignore`).
- Validar input em Edge Functions e em policies RLS.
- CSP definida em `vercel.json` — atualizar ao adicionar novos hosts.
