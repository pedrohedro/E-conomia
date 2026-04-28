# E-conomia — PRD (Product Requirements Document)

## Visão

Construir um **sistema de controle de estoque inteligente (WMS Lite)** para vendedores de e-commerce do Mercado Livre, consolidando visibilidade de estoque multi-origem (Full, Flex, Próprio), sincronização em tempo real e operações de armazém (endereçamento, picking, packing) em uma interface moderna e orientada a dados.

**Tech Stack:** Supabase (Postgres + Edge Functions + Realtime) + Vercel (Frontend)

## Modelo de Negócio

- **Freemium 6 meses** — aquisição de base de usuários sem fricção
- **Foco inicial:** Somente Mercado Livre (expandir outros marketplaces depois)
- **Vendedor-piloto:** Já usa Mercado Envios Full ✅

## Personas

| Persona | Perfil | Dor Principal |
|:---|:---|:---|
| **João** (Primária) | Vendedor ML, 50-500 SKUs, R$30-150k/mês | "Perco vendas porque não sei quando o estoque Full acabou" |
| **Ana** (Secundária) | Operadora de armazém, separa/embala | "Não sei onde está o produto, perco tempo procurando" |
| **Carlos** (Terciária) | Vendedor grande, 500-2000 SKUs | "Preciso profissionalizar a operação" |

## Fases de Desenvolvimento

### Fase 1 — Fundação & Integração ML (MUST - MVP v0.1)
- [x] ~~Schema base (produtos, estoque, pedidos, integrações)~~ → Já existe
- [ ] ECOM-74: Schema Evolution — Stock Locations Multi-Origem
- [ ] ECOM-75: Edge Function — ML OAuth Flow Completo
- [ ] ECOM-76: Edge Function — Webhook Receiver ML
- [ ] ECOM-77: Sync Engine — Reconciliação Estoque ML ↔ Local
- [ ] ECOM-93: Definição de Personas e Segmentos
- [ ] ECOM-94: Onboarding Flow — First-Time UX

### Fase 2 — Core Inventory (MUST - MVP v0.2)
- [ ] ECOM-78: Dashboard de Estoque Unificado
- [ ] ECOM-79: Sync Bidirecional de Estoque ML
- [ ] ECOM-80: Sistema de Alertas Inteligentes
- [ ] ECOM-81: Movimentações de Estoque — Log Completo
- [ ] ECOM-87: Pipeline de Pedidos ML — Sync Completo
- [ ] ECOM-95: Error Handling Global — Graceful Degradation
- [ ] ECOM-96: Landing Page + Cadastro Freemium

### Fase 3 — Operações (SHOULD)
- [ ] ECOM-82: Ordens de Compra a Fornecedores — UI
- [ ] ECOM-88: Etiquetas de Envio ML — Geração e Impressão
- [ ] ECOM-89: Reposição de Estoque Full — Workflow Inbound

### Fase 4 — WMS Lite (COULD)
- [ ] ECOM-83: Endereçamento de Armazém (Localizações Físicas)
- [ ] ECOM-84: Picking Dirigido — Lista de Separação
- [ ] ECOM-90: Curva ABC — Análise de Giro por Produto
- [ ] ECOM-91: Alertas Preditivos de Estoque
- [ ] ECOM-92: Custo de Armazenagem Full na Margem

### Fase 5 — WMS Avançado (WON'T v1)
- [ ] ECOM-85: Barcode/QR Scanning para Conferência
- [ ] ECOM-86: Packing Station — Validação e Embalagem

## Done When
- [ ] Vendedor conecta conta ML e vê estoque em < 5 minutos (onboarding)
- [ ] Estoque sincronizado em tempo real (< 5s via webhook)
- [ ] Alertas de estoque baixo/crítico funcionais
- [ ] Dashboard unificado mostrando Full + Flex + Próprio
- [ ] 50 vendedores ativos no mês 3 (meta de aquisição)

## Decisões Pendentes
- ⏳ **Reunião com investidor (Quarta):** Validar se escopo WMS Lite está correto ou se precisa de WMS completo
- ⏳ **Fase 4 e 5:** Detalhamento depende da validação do investidor

## Referências
- [Implementation Plan](file:///Users/pedrohedro/.gemini/antigravity/brain/715980c3-7a20-4f7d-b32a-60494ddc38ba/implementation_plan.md)
- [Task Review (PM/PO)](file:///Users/pedrohedro/.gemini/antigravity/brain/715980c3-7a20-4f7d-b32a-60494ddc38ba/task_review.md)
- [Specialist Review](file:///Users/pedrohedro/.gemini/antigravity/brain/715980c3-7a20-4f7d-b32a-60494ddc38ba/specialist_review.md)
- [Linear Board](https://linear.app/devops-dreamsquad/team/ECOM/backlog)

## Notes
- Todas as lógicas seguem `ARCHITECTURE.md` para evitar refatoração futura
- Construído sobre Supabase-JS com Edge Functions em Deno
- Tokens do ML devem ser criptografados (pgcrypto/Vault)
- Webhooks ML não enviam dados — apenas resource URL (precisa GET adicional)
