# E-conomia: Pivot Estratégico — Controle de Estoque & Integração Mercado Livre

## TL;DR — Resposta à Pergunta do Investidor

> [!IMPORTANT]
> **Focar em estoque ≠ virar um WMS.** O que vocês precisam é de um **ERP Inventory-First** para e-commerce, não um WMS de armazém. A diferença é crucial para escopo, custo e tempo de entrega.

---

## 1. WMS vs. Controle de Estoque: O que vocês realmente precisam?

### A Distinção

| Aspecto | Controle de Estoque (ERP) | WMS Completo |
|:---|:---|:---|
| **Foco** | "Quanto tenho? Onde está? Quando repor?" | "Onde armazenar? Qual corredor? Qual rota de picking?" |
| **Complexidade** | Média — saldo, movimentações, alertas | Alta — endereçamento, RF/barcode scanning, rota de picker |
| **Usuário-alvo** | Dono de e-commerce, equipe pequena | Operador de CD com 10+ funcionários |
| **Custo de dev** | ~3-4 meses MVP | ~8-12 meses MVP |
| **Concorrentes** | Bling, Tiny, Omie | TOTVS WMS, SAP EWM, Deagor |

### Módulos de um WMS Real (que vocês **NÃO precisam** agora)

- ❌ **Endereçamento de armazém** (rua, prateleira, bin)
- ❌ **Picking dirigido** (rota otimizada por corredor, wave/batch/zone picking)
- ❌ **Packing station** (cartonização, validação por scan)
- ❌ **Dock scheduling** (agendamento de docas)
- ❌ **RFID/Scanner integration**
- ❌ **Labor Management** (produtividade de operadores)
- ❌ **Yard management** (pátio de caminhões)

### O que vocês **SIM precisam** (Inventory-First ERP)

- ✅ **Saldo multi-canal em tempo real** (ML Full, ML Flex, Amazon FBA, estoque próprio)
- ✅ **Sincronização bidirecional com marketplaces** (puxa estoque do ML, empurra atualização)
- ✅ **Alertas inteligentes** (estoque mínimo, curva ABC, giro)
- ✅ **Movimentações rastreáveis** (entrada compra, saída venda, transferência, devolução)
- ✅ **Ordens de compra a fornecedores** (já tem schema!)
- ✅ **Custo médio / FIFO** para cálculo de margem real
- ✅ **Dashboard operacional** — o que separar, embalar, despachar hoje
- ✅ **Integração com Mercado Envios Full** — visibilidade do estoque no CD do ML

> [!TIP]
> **Recomendação:** Posicionar como **"Controle de Estoque Inteligente para E-commerce"** — não como WMS. Isso é mais vendável, mais rápido de construir, e atende exatamente a dor do vendedor de marketplace.

---

## 2. Mercado Livre — APIs Disponíveis para Integração

### 2.1 Autenticação & Setup

| Recurso | Endpoint | Descrição |
|:---|:---|:---|
| OAuth 2.0 | `POST /oauth/token` | Fluxo de autorização padrão |
| Token Refresh | `POST /oauth/token` (grant_type=refresh_token) | Renovação automática |
| User Info | `GET /users/$USER_ID` | Dados do vendedor, verifica tag `warehouse_management` |

### 2.2 Gestão de Produtos & Estoque

| Recurso | Endpoint | O que faz |
|:---|:---|:---|
| **Listar itens do vendedor** | `GET /users/$USER_ID/items/search` | Lista todos os anúncios |
| **Detalhes do item** | `GET /items/$ITEM_ID` | Inclui `available_quantity` |
| **User Products** (novo modelo) | `GET /user-products/$USER_PRODUCT_ID` | Agrupa anúncios por produto |
| **Stock por localização** | `GET /user-products/$ID/stock` | Retorna estoque por origem (Full vs próprio) |
| **Atualizar estoque** | `PUT /items/$ITEM_ID` com `available_quantity` | Sincronização de saldo |

#### Resposta de Stock por Localização (Multi-Origem)
```json
{
  "locations": [
    {
      "type": "meli_facility",    // Estoque no CD do Mercado Livre (Full)
      "quantity": 2
    },
    {
      "type": "seller_warehouse", // Estoque próprio do vendedor
      "quantity": 10
    }
  ]
}
```

### 2.3 Pedidos & Logística

| Recurso | Endpoint | O que faz |
|:---|:---|:---|
| **Buscar pedidos** | `GET /orders/search?seller=$SELLER_ID` | Pedidos por período/status |
| **Detalhes do pedido** | `GET /orders/$ORDER_ID` | Dados completos + itens |
| **Shipment** | `GET /shipments/$SHIPMENT_ID` | Dados de envio, rastreio |
| **Etiqueta de envio** | `GET /shipment_labels` | Gera PDF da etiqueta |

### 2.4 Webhooks (Notificações Real-Time)

| Tópico | Quando dispara | Uso no Sistema |
|:---|:---|:---|
| `orders_v2` | Pedido criado ou status muda | Atualizar pipeline, baixar estoque |
| `items` | Preço, status ou quantidade muda | Sincronizar catálogo |
| `shipments` | Status do envio muda | Atualizar tracking |
| `payments` | Pagamento criado/aprovado | Reconciliação financeira |
| **`stock_locations`** | Estoque em qualquer origem muda | ⭐ Core do controle de estoque |
| **`stock_fulfillment`** | Operação no estoque Full (FBM) | ⭐ Visibilidade do CD do ML |
| `questions` | Pergunta recebida | Atendimento |
| `messages` | Mensagem recebida | Atendimento |
| `claims` | Reclamação criada | Pós-venda |

> [!IMPORTANT]
> Os webhooks `stock_locations` e `stock_fulfillment` são **fundamentais** para o controle de estoque. Eles permitem saber em tempo real quando o ML movimentou mercadoria no CD deles.

### 2.5 Fulfillment — Modelos do Mercado Livre

| Modelo | Como funciona | Gestão de Estoque | Entrega |
|:---|:---|:---|:---|
| **Mercado Envios Full** | Vendedor envia estoque para CD do ML. ML armazena, separa, embala e envia. | **Terceirizada** (no CD do ML) | Nacional, "Chega amanhã" |
| **Mercado Envios Flex** | Vendedor entrega com frota própria/motoboy no mesmo dia. | **Própria** (no endereço do vendedor) | Local/Regional, mesmo dia |
| **Mercado Envios Coleta** | ML coleta no endereço do vendedor via Correios/transportadora. | **Própria** | Nacional, 2-7 dias |
| **Places** | Ponto de coleta/entrega físico. | **Própria** | Retirada em loja |

#### Implicações para o Sistema

```
📦 Vendedor típico opera com MIX:
├── Full: 60% dos SKUs mais vendidos (high-rotation)
├── Flex: 20% para região metropolitana (same-day)
└── Coleta: 20% restante (long-tail, itens grandes)

🔑 Nosso sistema precisa:
├── Visualizar estoque em TODAS as origens simultaneamente
├── Saber quanto tem no CD do ML vs. quanto tem em casa
├── Alertar quando estoque Full está acabando (precisa reabastecer CD)
└── Calcular custo de armazenagem Full vs. margem do produto
```

---

## 3. Análise Competitiva — Brasil

### Concorrentes Diretos (ERPs com foco marketplace)

| Produto | Preço/mês | Pontos Fortes | Pontos Fracos |
|:---|:---|:---|:---|
| **Bling** | R$ 30-250 | Plug-and-play ML, NF-e, popular | UI datada, lento com volume alto |
| **Tiny ERP** | R$ 50-300 | Robusto, bom para scaling | Complexo de configurar |
| **Omie** | R$ 100-500+ | ERP completo (360°), contábil forte | Overkill para e-commerce puro |
| **Hubs (IntegraCommerce)** | Variável | Multi-marketplace nativo | Foco em hub, estoque básico |

### Oportunidade de Diferenciação

> [!TIP]
> Nenhum desses concorrentes oferece **visibilidade em tempo real do estoque no CD do Mercado Livre (Full)** integrado com análise financeira de margem. Isso é um gap de mercado real.

**Diferenciais possíveis:**
1. **Estoque Full em tempo real** — saber exatamente quanto tem no armazém do ML
2. **Custo de armazenagem Full calculado na margem** — ML cobra por dia/volume
3. **Alertas preditivos** — "seu estoque Full de X acaba em 3 dias, envie reposição"
4. **Dashboard unificado** — Full + Flex + próprio em uma tela
5. **Análise de giro por canal** — Curva ABC por marketplace

---

## 4. O que já existe no codebase vs. o que falta

### ✅ Já temos (aproveitável)

| Componente | Schema | Status |
|:---|:---|:---|
| Produtos com SKU, custo, preço, margem | `products` (00004) | ✅ Sólido |
| Estoque multi-canal | `channel_stock` (00004) | ✅ Sólido |
| Movimentações de estoque | `stock_movements` (00004) | ✅ Sólido |
| Trigger de recálculo automático | `recalculate_product_stock()` | ✅ Funciona |
| Reserva atômica anti-overselling | `reserve_channel_stock()` (00019) | ✅ Sólido |
| Alertas de estoque (normal/low/critical/out) | `stock_alert_level` enum | ✅ Existe |
| Integração OAuth ML | `marketplace_integrations` (00003) | ✅ Estrutura OK |
| Sync logs | `sync_logs` (00003) | ✅ Existe |
| Pedidos multi-marketplace | `orders` (00005) | ✅ Robusto |
| Fornecedores + Ordens de Compra | `suppliers`, `purchase_orders` (00016) | ✅ Existe |
| Fulfillment types (Full/Flex/Coleta/FBA) | `fulfillment_type` enum | ✅ Completo |

### 🔧 Precisa evoluir

| O que falta | Prioridade | Descrição |
|:---|:---|:---|
| **Stock Locations (Multi-Origem)** | P0 | Diferenciar estoque próprio vs. ML Full vs. ML Flex por SKU |
| **Webhook receiver para ML** | P0 | Edge Function que recebe `stock_locations`, `stock_fulfillment`, `orders_v2` |
| **Sync bidirecional de estoque** | P0 | Ler estoque do ML → atualizar local; Atualizar local → empurrar para ML |
| **Dashboard de estoque** | P1 | Tela principal: visão unificada, alertas, ações rápidas |
| **Cron de reconciliação** | P1 | Job periódico que valida estoque local vs. ML para detectar divergências |
| **Custo de armazenagem Full** | P2 | Calcular custo de storage ML por produto/dia e incluir na margem |
| **Alertas preditivos** | P2 | "Estoque Full acaba em X dias" baseado em velocidade de venda |
| **Curva ABC / Giro** | P2 | Classificação automática de produtos por rotatividade |
| **Transferência de estoque** | P2 | Envio de reposição para CD do ML (workflow de inbound) |

---

## 5. Arquitetura Proposta

```
                        ┌─────────────────────────────────┐
                        │        MERCADO LIVRE API         │
                        │  (Items, Orders, Stock, Ships)   │
                        └───────┬───────────────┬──────────┘
                                │               │
                         Webhooks (push)    Cron Sync (pull)
                                │               │
                        ┌───────▼───────────────▼──────────┐
                        │      SUPABASE EDGE FUNCTIONS      │
                        │                                   │
                        │  ┌──────────┐  ┌──────────────┐  │
                        │  │ Webhook  │  │  Sync Cron   │  │
                        │  │ Handler  │  │  (5min poll)  │  │
                        │  └────┬─────┘  └──────┬───────┘  │
                        │       │               │          │
                        │  ┌────▼───────────────▼───────┐  │
                        │  │   Stock Reconciliation     │  │
                        │  │   Engine (business logic)  │  │
                        │  └────────────┬───────────────┘  │
                        └───────────────┼──────────────────┘
                                        │
                        ┌───────────────▼──────────────────┐
                        │         SUPABASE (Postgres)       │
                        │                                   │
                        │  products ◄──► channel_stock      │
                        │       │            │              │
                        │  stock_movements   stock_locations │
                        │       │            │              │
                        │  purchase_orders   sync_logs      │
                        │                                   │
                        │  [Realtime via Postgres Channels] │
                        └───────────────┬──────────────────┘
                                        │
                        ┌───────────────▼──────────────────┐
                        │        FRONTEND (Vercel)          │
                        │                                   │
                        │  ┌─────────┐  ┌──────────────┐   │
                        │  │Estoque  │  │  Pipeline de │   │
                        │  │Dashboard│  │  Pedidos     │   │
                        │  └─────────┘  └──────────────┘   │
                        │  ┌─────────┐  ┌──────────────┐   │
                        │  │Compras  │  │  Financeiro  │   │
                        │  │(PO)     │  │  (Margens)   │   │
                        │  └─────────┘  └──────────────┘   │
                        └──────────────────────────────────┘
```

---

## User Review Required

> [!WARNING]
> **Decisão estratégica fundamental:** Este plano propõe manter o projeto como **ERP Inventory-First** (controle de estoque inteligente para e-commerce) e **NÃO** pivotar para WMS completo. Se o investidor especificamente quer um WMS com picking/packing/endereçamento de armazém, precisamos rediscutir escopo e timeline.

## Open Questions

> [!IMPORTANT]
> Preciso das respostas abaixo para avançar no plano de implementação:

### 1. Escopo do "Controle de Estoque"
O investidor quer:
- **(A)** Controle de saldo + alertas + sincronização ML (ERP Inventory-First) — **~3-4 meses MVP**
- **(B)** Tudo de (A) + endereçamento de armazém, picking dirigido, scanning (WMS Lite) — **~6-8 meses MVP**
- **(C)** WMS completo com dock management, labor tracking, etc. — **~10-12 meses MVP**

### 2. Multi-Marketplace: Qual prioridade?
O schema já suporta Amazon, Shopee, Nuvemshop... Mas para o MVP:
- Focar **só no Mercado Livre**?
- Ou já incluir **Amazon FBA** também?

### 3. Mercado Envios Full: O vendedor-piloto já usa?
- Se sim: podemos testar a integração `stock_fulfillment` imediatamente
- Se não: focamos em estoque próprio + ML Coleta primeiro

### 4. Monetização: Como vocês planejam cobrar?
- SaaS mensal por tier (como Bling)?
- Freemium + planos pro?
- Isso impacta se precisamos do módulo de subscriptions (Stripe, já tem schema 00011)

### 5. Módulo Financeiro: Mantém ou simplifica?
- O schema já tem DRE, despesas, margem calculada...
- O investidor quer manter isso ou focar 100% no estoque primeiro?

---

## Próximos Passos (após suas respostas)

1. **Criar `PLAN-estoque-ml.md`** com task breakdown detalhado
2. **Definir schema evolution** — nova migration para `stock_locations` multi-origem
3. **Priorizar Edge Functions** — webhook receiver + sync engine
4. **Prototipar dashboard** — tela de estoque unificada

---

*Pesquisa realizada em 27/04/2026. Fontes: Mercado Libre Developers Portal, documentação oficial de APIs, análise de mercado brasileiro.*
