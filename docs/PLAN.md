# E-conomia CRM - PLAN & PRD

## Goal
Construir um CRM e ERP tático voltado para donos de e-commerce e marketplaces, consolidando dados de múltiplos canais de venda (Mercado Livre, Amazon, Shopee, Nuvemshop) em uma interface moderna, rápida e orientada a dados (Data-Driven), unificando gestão de estoque, resultados financeiros e controle operacional usando Supabase como backend e Vercel.

## Tasks
- [ ] Task 1: **Fundação & Autenticação** - Implementar Supabase Auth, roles (RBAC) e tabela de Organizações (Multi-Tenant). → Verify: Auth cria perfil e redireciona.
- [ ] Task 2: **Gestão de Produtos** - Implementar CRUD de SKU, fornecedores e `channel_stock`. → Verify: Trigger de `total_stock` e alerta funcional.
- [ ] Task 3: **Integração Mercado Livre** - Edge Functions de OAuth, Token Refresh, Webhooks e Cron jobs. → Verify: Conta ML logada, sincronização de pedidos automática e estoque bidirecional.
- [ ] Task 4: **Pipeline de Pedidos** - Sincronizar na tela de `vendas.html` os pedidos do BD. Modificar pipeline logs. → Verify: Status no frontend reflete com 100% de veracidade o backend Supabase.
- [ ] Task 5: **Módulo Contábil/Financeiro** - Conectar o fluxo da tabela `expenses` e extrato ao `contabil.html`. → Verify: Gráficos Chart.js mostram margens reais baseadas no SQL gerado por DRE.
- [ ] Task 6: **Analytics & Realtime** - Utilizar Postgres Channels para atualizações ao vivo e notificar via websocket (Live Feed de Vendas). → Verify: Nova venda pinga instantaneamente na UI sem f5.

## Done When
- [ ] Supabase atende as 6 fases estipuladas no `ARCHITECTURE.md`.
- [ ] 100% dos mock datas viraram fetchs com o front consumindo APIs do Supabase RLS.

## Notes
- Fase 1 de planejamento do Orquestrador: Todas as lógicas seguirão `ARCHITECTURE.md` para evitar refatoração futura. Tudo construído sobre Supabase-JS.
