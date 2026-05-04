# Projeção de Custos Mensais (OPEX) — E-conomia
**Meta:** Suporte para 1.000 Usuários Ativos

Abaixo está o detalhamento dos custos operacionais estimados para manter a infraestrutura híbrida estável e performática.

| Ferramenta | Finalidade | Plano / Tier Estimado | Custo Mensal (USD) |
| :--- | :--- | :--- | :--- |
| **Supabase** | Banco de Dados, Auth, Realtime | Pro Plan + Add-ons (Compute/Storage) | ~$150.00 |
| **Render** | Background Workers (Sync Marketplaces) | Starter ou Standard Instance | ~$7.00 - $15.00 |
| **Claude AI** | Aceleração de Desenvolvimento (Dev Lead) | Claude Max 20x (1 licença) | $200.00 |
| **Vercel** | Hospedagem do Frontend | Pro Plan (1 seat) | $20.00 |
| **AWS SES** | E-mails Transacionais e Alertas | Pay-as-you-go ($0.10/1k emails) | ~$5.00 |
| **Domínio/Misc** | Gestão de DNS e Outros | Registro Anual Pro-rata | ~$2.00 |
| **TOTAL ESTIMADO** | | | **~$384.00 - $392.00** |

## Detalhamento Técnico dos Custos

### 1. Supabase ($150.00)
* **Base:** $25.00 do plano Pro.
* **Compute:** Upgrade necessário para instâncias de banco de dados maiores conforme o volume de escrita em `stock_movements` aumente.
* **Realtime:** Orçamento para exceder as 500 conexões simultâneas do plano base.

### 2. Render ($7.00 - $15.00)
* Uso de uma instância "Web Service" ou "Worker" para rodar o Graphile Worker continuamente. O custo é fixo, independente do número de jobs, até o limite de RAM/CPU da instância.

### 3. Claude Max 20x ($200.00)
* Investimento em produtividade técnica para garantir que a arquitetura complexa de integração com APIs (Amazon, ML, Shopee) seja desenvolvida e mantida sem gargalos humanos.

### 4. AWS SES (~$5.00)
* Estimativa conservadora para 1.000 usuários gerando um alto volume de notificações de estoque e confirmações de pedidos. O custo real pode ser menor dependendo do volume exato.
