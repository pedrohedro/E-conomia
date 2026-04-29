# PLAN-estoque-ml.md — Task Breakdown: Estoque ML + WMS Lite

**Criado:** 28/04/2026  
**Status:** Aprovado (auto-approved)  
**Linear Board:** [ECOM Backlog](https://linear.app/devops-dreamsquad/team/ECOM/backlog)  
**Referências:** [Implementation Plan](file:///Users/pedrohedro/.gemini/antigravity/brain/715980c3-7a20-4f7d-b32a-60494ddc38ba/implementation_plan.md) · [Specialist Review](file:///Users/pedrohedro/.gemini/antigravity/brain/715980c3-7a20-4f7d-b32a-60494ddc38ba/specialist_review.md)

---

## Visão Geral

Transformar o E-conomia de CRM genérico em **Inventory-First ERP** para vendedores do Mercado Livre. 
Foco: estoque multi-origem (Full/Flex/Próprio), sincronização real-time via webhooks, alertas preditivos.

**Modelo:** Freemium 6 meses → aquisição agressiva  
**Stack:** Supabase (Postgres + Edge Functions + Realtime) + Vercel (Frontend estático)

---

## Fase 1 — Fundação & Integração ML (Semanas 1-3)

> **Objetivo:** Vendedor conecta conta ML e vê estoque em < 5 minutos.

### ECOM-74: Schema Evolution — Stock Locations Multi-Origem
- **Prioridade:** P0 MUST | **Esforço:** 3-5h | **Bloqueador de:** ECOM-78
- **Tarefas:**
  - [ ] Criar migration `00020_stock_locations.sql`
  - [ ] Tabela `stock_locations` com UNIQUE(org, product, location_type, location_id)
  - [ ] Coluna `available` GENERATED ALWAYS AS (quantity - reserved) STORED
  - [ ] Trigger `recalculate_total_stock_from_locations()` 
  - [ ] RLS policies (org isolation via `get_user_org_ids()`)
  - [ ] View `vw_stock_by_location` para dashboard
  - [ ] Migrar dados existentes de `channel_stock` → `stock_locations`
  - [ ] Testes: inserir/atualizar location, verificar total recalcula

### ECOM-75: Edge Function — ML OAuth Flow Completo
- **Prioridade:** P0 MUST | **Esforço:** 4-6h | **Bloqueador de:** ECOM-76, 77, 79
- **Tarefas:**
  - [x] Refatorar `marketplace-authorize/index.ts` — gerar state token anti-CSRF
  - [x] Usar tabela `oauth_states` (migration 00018) com TTL 10 min
  - [x] Refatorar `marketplace-callback/index.ts` — trocar code por tokens
  - [x] Criptografar access_token e refresh_token antes de salvar (pgcrypto)
  - [x] Salvar `seller_id` em `marketplace_integrations`
  - [x] Edge Function `token-refresh/index.ts` — cron que renova 30min antes do vencimento
  - [x] Fallback: se refresh falhar 3x → status `token_expired` + notificar
  - [x] Testes: fluxo completo auth → callback → token storage

### ECOM-93: Definição de Personas e Segmentos
- **Prioridade:** P0 MUST | **Esforço:** 2-3h
- **Tarefas:**
  - [ ] Documentar 3 personas (João/Ana/Carlos) com jobs-to-be-done
  - [ ] Definir limites de segmento: Starter (≤100 SKUs), Pro (100-500), Enterprise (500+)
  - [ ] User stories Gherkin para cada persona na Fase 1
  - [ ] Validar com investidor (reunião quarta)

### ECOM-94: Onboarding Flow — First-Time UX
- **Prioridade:** P0 MUST | **Esforço:** 6-8h | **Depende de:** ECOM-75
- **Tarefas:**
  - [x] Refatorar `onboarding.html` — não redirecionar para login
  - [x] Tela 1: "Conecte seu Mercado Livre" → botão grande → OAuth
  - [x] Tela 2: Loading animado "Importando seus produtos..." com progress bar
  - [x] Tela 3: "Pronto! Você tem X produtos" → CTA "Ver meu estoque"
  - [x] Progressive disclosure: sem wizard de 10 passos
  - [x] Redirect para dashboard já populado após onboarding
  - [x] Tour opcional (3 tooltips): estoque, alertas, sync status

---

## Fase 2 — Core Inventory (Semanas 3-6)

> **Objetivo:** Estoque sincronizado em tempo real, alertas funcionais, dashboard operacional.

### ECOM-76: Edge Function — Webhook Receiver ML
- **Prioridade:** P0 MUST | **Esforço:** 6-8h | **Depende de:** ECOM-75
- **Tarefas:**
  - [x] Criar/refatorar `webhook-handler/index.ts`
  - [x] Roteamento por `topic`: stock_locations, stock_fulfillment, orders_v2, items, shipments
  - [x] **IMPORTANTE:** ML não envia dados — apenas `resource` URL. Precisa GET adicional
  - [x] Responder HTTP 200 em < 500ms (ML retry 3x se não receber)
  - [x] Fila assíncrona: responder 200 imediatamente, processar em background
  - [x] Tabela de idempotência: `webhook_dedup(resource, sent, processed_at)`
  - [x] Validação de origem: IP whitelist + `application_id`
  - [x] Rate limiter local: token bucket para chamadas à API ML (~100 req/min)
  - [x] Testes: simular webhook, verificar que estoque atualiza

### ECOM-77: Sync Engine — Reconciliação Estoque ML ↔ Local
- **Prioridade:** P0 MUST | **Esforço:** 5-7h | **Depende de:** ECOM-75
- **Tarefas:**
  - [ ] Refatorar `reconcile-stock/index.ts`
  - [ ] Estratégia híbrida:
    - Webhooks: ~95% das atualizações (real-time)
    - Cron leve (15min): verificar apenas items com divergência recente
    - Reconciliação completa (1x/dia, off-peak): comparar TUDO
  - [ ] **NÃO fazer:** Cron a cada 5min para todos os items (estoura rate limit ML)
  - [ ] Usar `last_synced_at` para sync incremental
  - [ ] Log de divergências em `sync_logs`
  - [ ] Alerta se divergência > 10% ou > 5 unidades
  - [ ] Testes: simular divergência, verificar reconciliação

### ECOM-78: Dashboard de Estoque Unificado
- **Prioridade:** P1 MUST | **Esforço:** 8-10h | **Depende de:** ECOM-74
- **Tarefas:**
  - [ ] Refatorar `estoque.html` com novo layout:
    - Status bar: "ML Conectado ✅ Última sync: 2min"
    - KPIs: Total SKUs, Em Alerta, Sem Estoque, Valor Total
    - Filtros: Canal ▾ Status ▾ Categoria ▾ 🔍 Busca
    - Tabela: SKU | Produto | Full | Flex | Próprio | Total
  - [ ] Cores por status: 🟢 OK, 🟡 Low, 🔴 Critical, ⬛ Out
  - [ ] Indicadores visuais por localização (badges Full/Flex/Próprio)
  - [ ] **Empty state** — tela para quando vendedor não tem produtos
  - [ ] **Loading state** — skeleton loader durante sync inicial
  - [ ] **Ação em lote** — selecionar múltiplos SKUs para ajustar estoque
  - [ ] Realtime updates via Supabase Realtime (subscribe to stock_locations changes)

### ECOM-79: Sync Bidirecional de Estoque ML
- **Prioridade:** P1 MUST | **Esforço:** 4-6h | **Depende de:** ECOM-75
- **Tarefas:**
  - [ ] Refatorar `push-stock-to-ml/index.ts`
  - [ ] Direção 1: ML → Local (webhook + sync engine — já coberto por ECOM-76/77)
  - [ ] Direção 2: Local → ML (`PUT /items/{id}` com `available_quantity`)
  - [ ] Rate limiting local (token bucket)
  - [ ] Retry com backoff exponencial
  - [ ] Validação antes de push: não enviar se divergência está sendo investigada
  - [ ] Testes: atualizar estoque local, verificar que ML reflete

### ECOM-80: Sistema de Alertas Inteligentes
- **Prioridade:** P1 MUST | **Esforço:** 3-5h
- **Tarefas:**
  - [ ] Verificar que `check-stock-alerts/index.ts` funciona com novo schema
  - [ ] Alertas current: out_of_stock, critical, low
  - [ ] Alertas preditivos: "acaba em X dias" (já implementado por Claude Code)
  - [ ] Deduplicação: currentlyAlertedSkus Set (já implementado)
  - [ ] Bell icon no header com badge de contagem
  - [ ] Dropdown de notificações (últimas 10)
  - [ ] Testes: simular estoque baixo, verificar notificação

### ECOM-81: Movimentações de Estoque — Log Completo
- **Prioridade:** P1 MUST | **Esforço:** 4-5h
- **Tarefas:**
  - [ ] UI para visualizar `stock_movements` por produto
  - [ ] Filtros: tipo (venda, compra, ajuste, transferência), período, produto
  - [ ] Timeline visual com ícones por tipo de movimento
  - [ ] Botão "Ajustar estoque manualmente" (movement_type = 'adjustment')
  - [ ] Integração: movimentos automáticos quando webhook recebe venda

### ECOM-87: Pipeline de Pedidos ML — Sync Completo
- **Prioridade:** P1 MUST | **Esforço:** 5-7h | **Depende de:** ECOM-76
- **Tarefas:**
  - [ ] Refatorar `sync-orders/index.ts` para novo fluxo de webhooks
  - [ ] Mapear status ML → status local: confirmed→approved, payment_required→pending, etc.
  - [ ] Dados do comprador: nickname, email, CPF (quando disponível)
  - [ ] Items do pedido: title, quantity, unit_price, thumbnail
  - [ ] Shipping: tracking number, carrier, estimated delivery
  - [ ] Realtime: Supabase channel para updates no pipeline (já implementado em pedidos.html)

### ECOM-95: Error Handling Global — Graceful Degradation
- **Prioridade:** P1 MUST | **Esforço:** 4-6h
- **Tarefas:**
  - [ ] Tabela `ml_cache` para dados ML (último estado válido, TTL 5min)
  - [ ] Circuit breaker em `marketplace_integrations.config` JSONB:
    - `consecutive_failures`, `state` (closed/open/half-open), `cooldown_seconds`
  - [ ] Quando ML API cai: servir dados do cache + banner "Dados podem estar desatualizados"
  - [ ] Auto-recovery: half-open após cooldown, fecha circuit se sucesso
  - [ ] Testes: simular ML offline, verificar graceful degradation

### ECOM-96: Landing Page + Cadastro Freemium
- **Prioridade:** P1 MUST | **Esforço:** 6-8h
- **Tarefas:**
  - [ ] Refatorar `landing.html` com messaging de estoque (não CRM genérico)
  - [ ] Hero: "Controle de Estoque Inteligente para Vendedores do Mercado Livre"
  - [ ] Feature cards: sync real-time, alertas preditivos, multi-origem
  - [ ] CTA: "Comece Grátis — 6 meses sem cobrar"
  - [ ] Social proof: "Para vendedores com 50 a 2000 SKUs"
  - [ ] Formulário de cadastro → Supabase Auth → Onboarding

---

## Fase 3 — Operações (Semanas 6-8) — SHOULD

### ECOM-82: Ordens de Compra a Fornecedores — UI
- **Prioridade:** P1 SHOULD | **Esforço:** 6-8h
- **Tarefas:**
  - [ ] UI para `purchase_orders` (schema já existe em 00016)
  - [ ] Criar PO → selecionar fornecedor → adicionar items com qty/preço
  - [ ] Status workflow: draft → sent → partial → received → closed
  - [ ] Recebimento: ao receber, criar `stock_movements` de entrada
  - [ ] PDF de PO para enviar ao fornecedor

### ECOM-88: Etiquetas de Envio ML — Geração e Impressão
- **Prioridade:** P1 SHOULD | **Esforço:** 4-5h | **Depende de:** ECOM-87
- **Tarefas:**
  - [ ] Refatorar `generate-label/index.ts`
  - [ ] `GET /shipment_labels` com access_token do ML
  - [ ] Gerar PDF embeddable ou abrir em nova aba
  - [ ] Impressão em lote (selecionar múltiplos pedidos)
  - [ ] Integrar no modal de pedido (botão "Gerar Etiqueta")

### ECOM-89: Reposição de Estoque Full — Workflow Inbound
- **Prioridade:** P1 SHOULD | **Esforço:** 5-7h
- **Tarefas:**
  - [ ] Workflow: "Preciso enviar X unidades para o CD do ML"
  - [ ] Lista de produtos com estoque Full baixo
  - [ ] Gerar lista de separação para reposição
  - [ ] Checklist de embalagem (requisitos do ML Full)
  - [ ] Registro de envio: transportadora, código de rastreio
  - [ ] Atualizar status quando ML confirma recebimento (webhook stock_fulfillment)

---

## Fase 4 — WMS Lite (Semanas 8-12) — COULD

> ⏳ **Depende da validação do investidor na quarta-feira.**

### ECOM-83: Endereçamento de Armazém
- **Prioridade:** P2 COULD | **Esforço:** 5-7h | **Depende de:** ECOM-78
- **Tarefas:**
  - [ ] Migration `warehouse_locations` + `product_locations` (N:N)
  - [ ] Hierarquia: Zona > Corredor > Prateleira > Posição (código gerado: "A-03-C-07")
  - [ ] UI: grid visual do armazém com ocupação
  - [ ] Flag `is_primary` para localização de picking preferencial

### ECOM-84: Picking Dirigido — Lista de Separação
- **Prioridade:** P2 COULD | **Esforço:** 6-8h
- **Tarefas:**
  - [ ] Gerar lista de separação a partir de pedidos approved/preparing
  - [ ] Agrupar por localização (otimizar rota do picker)
  - [ ] **Mobile-first:** botões grandes (48px), alto contraste, feedback sonoro
  - [ ] Checkbox de confirmação por item
  - [ ] Impressão da lista de separação

### ECOM-90: Curva ABC — Análise de Giro
- **Prioridade:** P2 COULD | **Esforço:** 3-4h
- **Tarefas:**
  - [ ] Cálculo: vendas por SKU nos últimos 90 dias
  - [ ] Classificação: A (80% do faturamento), B (15%), C (5%)
  - [ ] Visualização: gráfico + tabela com recomendação de ação
  - [ ] Integrar com alertas: priorizar alertas para SKUs classe A

### ECOM-91: Alertas Preditivos de Estoque
- **Prioridade:** P2 COULD | **Esforço:** 3-4h | **Depende de:** ECOM-80
- **Tarefas:**
  - [ ] Já implementado parcialmente em `check-stock-alerts/index.ts`
  - [ ] Melhorar: considerar sazonalidade (média móvel ponderada)
  - [ ] UI: card "Previsão de Ruptura" no dashboard com timeline

### ECOM-92: Custo de Armazenagem Full na Margem
- **Prioridade:** P2 COULD | **Esforço:** 4-5h
- **Tarefas:**
  - [ ] ML cobra: R$ X/dia por unidade armazenada + taxa por volume
  - [ ] Calcular custo de storage por SKU
  - [ ] Incluir no cálculo de margem: receita - custo produto - taxa ML - storage
  - [ ] Alerta: "SKU X está com margem negativa por causa da armazenagem"

---

## Fase 5 — WMS Avançado (Pós-MVP) — WON'T v1

### ECOM-85: Barcode/QR Scanning
- [ ] Library: html5-qrcode (leve, PWA-friendly)
- [ ] Conferência de entrada (PO receiving)
- [ ] Conferência de saída (picking validation)

### ECOM-86: Packing Station
- [ ] Validação de pedido por scan antes de embalar
- [ ] Checklist de embalagem por marketplace (requisitos diferentes)
- [ ] Pesagem e dimensionamento

---

## ADRs (Architectural Decision Records)

| # | Decisão | Escolha | Motivo |
|:---|:---|:---|:---|
| ADR-01 | Fila de webhooks | Supabase Queue + pg_net | Resiliência, não perde eventos |
| ADR-02 | Cache de dados ML | Tabela Postgres (`ml_cache`) | Simplicidade, já tem Supabase |
| ADR-03 | Barcode scanning | html5-qrcode | Leve, PWA-friendly, sem deps |
| ADR-04 | Estratégia de sync | Webhook + Cron reconciliação | Real-time + safety net |
| ADR-05 | Token encryption | pgcrypto `pgp_sym_encrypt` | Tokens ML criptografados at rest |

---

## Critérios de Aceitação do MVP

- [ ] Vendedor conecta ML e vê estoque em < 5 minutos
- [ ] Estoque sincroniza via webhook em < 5 segundos
- [ ] Alertas de estoque baixo/crítico/zerado funcionam
- [ ] Dashboard unificado: Full + Flex + Próprio na mesma tela
- [ ] Pedidos do ML aparecem no pipeline em tempo real
- [ ] 50 vendedores ativos no mês 3 (meta aquisição)
- [ ] Graceful degradation quando API ML cai (cache + banner)
- [ ] Zero token exposure (todos criptografados)

---

## Estimativa de Esforço

| Fase | Issues | Esforço | Semanas |
|:---|:---|:---|:---|
| Fase 1 — Fundação | 4 issues | ~15-22h | Semanas 1-3 |
| Fase 2 — Core | 8 issues | ~38-54h | Semanas 3-6 |
| Fase 3 — Operações | 3 issues | ~15-20h | Semanas 6-8 |
| Fase 4 — WMS Lite | 5 issues | ~21-28h | Semanas 8-12 |
| **Total MVP (Fases 1-2)** | **12 issues** | **~53-76h** | **~6 semanas** |

---

*Plano criado em 28/04/2026. Atualizar após validação com investidor (quarta-feira).*
