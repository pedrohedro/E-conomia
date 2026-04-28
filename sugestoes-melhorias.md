# Sugestões de Melhorias Técnicas e de Produto — E-conomia

Este documento consolida as recomendações para otimizar a escalabilidade, estabilidade e o custo operacional do sistema, visando a meta de 1.000 usuários ativos.

## 1. Arquitetura Híbrida (Supabase + Render)
Para evitar as limitações de tempo de execução e memória das Edge Functions, a principal melhoria é a separação do "Compute":
* **Render Workers:** Implementar um serviço dedicado no Render (Node.js) para processar as filas de sincronização de estoque e pedidos.
* **Graphile Worker:** Utilizar este motor de mensageria que roda diretamente no PostgreSQL do Supabase, garantindo conformidade ACID e eliminando a necessidade de um cluster Redis adicional.
* **Connection Pooling:** Utilizar o Supavisor (Transaction Mode) para gerenciar as centenas de conexões que o Worker abrirá com o banco de dados.

## 2. Gestão de Estoque Multicanal (Foco do Investidor)
* **Atomicidade nas Transações:** Garantir que as atualizações de `channel_stock` ocorram dentro de transações DB para evitar "vendas fantasma" (overselling).
* **Priorização de Fila:** Implementar lógica para priorizar sincronizações de SKUs com baixo estoque (`stock_alert`).
* **Log de Movimentação:** Manter a tabela `stock_movements` otimizada com índices parciais para auditoria rápida sem comprometer a performance.

## 3. Comunicação e Notificações (Baixo Custo)
* **AWS SES para Transacionais:** Migrar do servidor SMTP padrão ou ferramentas caras (Resend/SendGrid) para o AWS SES, garantindo alta entregabilidade com custo de centavos.
* **Realtime Feed:** Utilizar os Postgres Channels do Supabase apenas para a UI ativa (Dashboard), economizando banda e processamento no backend.

## 4. Governança e Segurança
* **RLS (Row Level Security):** Revisar todas as políticas para garantir o isolamento multi-tenant absoluto antes da entrada dos primeiros 100 usuários.
* **Backups:** Configurar rotinas de backup Point-in-Time Recovery (PITR) no Supabase para proteção contra falhas catastróficas.
