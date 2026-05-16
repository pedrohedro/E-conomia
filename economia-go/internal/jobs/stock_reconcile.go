package jobs

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type StockReconcileService struct {
	db *pgxpool.Pool
}

func NewStockReconcileService(db *pgxpool.Pool) *StockReconcileService {
	return &StockReconcileService{db: db}
}

// ReconcileAll executa a reconciliação de estoque para todas as organizações ativas no ML
func (s *StockReconcileService) ReconcileAll() {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	log.Println("[CRON] Iniciando reconciliação de estoque Mercado Livre...")

	rows, err := s.db.Query(ctx, `
		SELECT id, organization_id, access_token 
		FROM marketplace_integrations 
		WHERE marketplace = 'mercado_livre' AND status = 'active'
	`)
	if err != nil {
		log.Printf("[CRON] Erro ao buscar integrações ativas: %v", err)
		return
	}
	defer rows.Close()

	type IntInfo struct {
		ID    string
		OrgID string
		Token string
	}
	var integrations []IntInfo
	for rows.Next() {
		var i IntInfo
		if err := rows.Scan(&i.ID, &i.OrgID, &i.Token); err == nil {
			integrations = append(integrations, i)
		}
	}
	rows.Close()

	for _, intg := range integrations {
		s.reconcileForOrg(ctx, intg.ID, intg.OrgID, intg.Token)
	}

	log.Println("[CRON] Concluída reconciliação de estoque Mercado Livre.")
}

func (s *StockReconcileService) reconcileForOrg(ctx context.Context, intgID, orgID, token string) {
	// Log início
	var logID string
	err := s.db.QueryRow(ctx, `
		INSERT INTO sync_logs (integration_id, organization_id, event_type, status, started_at)
		VALUES ($1, $2, 'stock_reconciliation', 'started', NOW())
		RETURNING id
	`, intgID, orgID).Scan(&logID)
	if err != nil {
		log.Printf("Erro ao criar sync_log: %v", err)
		return
	}

	// Buscar produtos do ML cadastrados em channel_stock
	rows, err := s.db.Query(ctx, `
		SELECT cs.id, cs.product_id, cs.channel_sku, cs.quantity, cs.reserved, cs.channel, p.name
		FROM channel_stock cs
		JOIN products p ON cs.product_id = p.id
		WHERE cs.organization_id = $1 AND cs.channel IN ('ml_full', 'ml_flex') AND cs.channel_sku IS NOT NULL
		ORDER BY cs.last_synced_at ASC NULLS FIRST
		LIMIT 100
	`, orgID)
	if err != nil {
		s.updateSyncLog(ctx, logID, "failed", 0, err.Error())
		return
	}

	type LocalItem struct {
		ID         string
		ProductID  string
		ChannelSKU string
		Quantity   int
		Reserved   int
		Channel    string
		ProdName   string
	}
	var items []LocalItem
	for rows.Next() {
		var item LocalItem
		if rows.Scan(&item.ID, &item.ProductID, &item.ChannelSKU, &item.Quantity, &item.Reserved, &item.Channel, &item.ProdName) == nil {
			items = append(items, item)
		}
	}
	rows.Close()

	if len(items) == 0 {
		s.updateSyncLog(ctx, logID, "completed", 0, "")
		return
	}

	// Processar em chunks de 20 para chamada à API do ML
	chunkSize := 20
	processedCount := 0
	divergencesFound := 0
	fixedCount := 0

	for i := 0; i < len(items); i += chunkSize {
		end := i + chunkSize
		if end > len(items) {
			end = len(items)
		}
		chunk := items[i:end]

		var skus []string
		itemMap := make(map[string]LocalItem)
		for _, it := range chunk {
			skus = append(skus, it.ChannelSKU)
			itemMap[it.ChannelSKU] = it
		}

		mlURL := fmt.Sprintf("https://api.mercadolibre.com/items?ids=%s&attributes=id,available_quantity,status", strings.Join(skus, ","))
		req, _ := http.NewRequestWithContext(ctx, http.MethodGet, mlURL, nil)
		req.Header.Set("Authorization", "Bearer "+token)

		resp, err := http.DefaultClient.Do(req)
		if err != nil || resp.StatusCode != http.StatusOK {
			if resp != nil {
				resp.Body.Close()
			}
			continue
		}

		var mlItems []struct {
			Code int `json:"code"`
			Body struct {
				ID                string `json:"id"`
				AvailableQuantity int    `json:"available_quantity"`
				Status            string `json:"status"`
			} `json:"body"`
		}
		if json.NewDecoder(resp.Body).Decode(&mlItems) == nil {
			for _, mlIt := range mlItems {
				if mlIt.Code != 200 || mlIt.Body.ID == "" {
					continue
				}

				processedCount++
				localIt, exists := itemMap[mlIt.Body.ID]
				if !exists {
					continue
				}

				mlQty := mlIt.Body.AvailableQuantity
				localQty := localIt.Quantity

				if localQty == mlQty {
					continue // Perfeitamente sincronizado
				}

				divergencesFound++
				diff := int(math.Abs(float64(mlQty - localQty)))

				if localIt.Channel == "ml_full" {
					// ML Full é source of truth: atualiza banco local
					newQty := mlQty + localIt.Reserved
					_, err := s.db.Exec(ctx, `
						UPDATE channel_stock 
						SET quantity = $1, last_synced_at = NOW(), updated_at = NOW() 
						WHERE id = $2
					`, newQty, localIt.ID)

					if err == nil {
						// Registra movimento de ajuste
						_, _ = s.db.Exec(ctx, `
							INSERT INTO stock_movements (organization_id, product_id, channel, movement_type, quantity, notes)
							VALUES ($1, $2, 'ml_full', 'adjustment', $3, $4)
						`, orgID, localIt.ProductID, mlQty-localQty, fmt.Sprintf("Reconciliação ML Full: ML=%d Local era=%d", mlQty, localQty))
						fixedCount++
					}
				} else {
					// Flex/Próprio: registra notificação de divergência para decisão do usuário
					severity := "low"
					if diff > 5 {
						severity = "medium"
					}
					if diff > 20 {
						severity = "high"
					}
					msg := fmt.Sprintf("Divergência detectada no produto %s (%s). ML: %d vs Local: %d", localIt.ProdName, localIt.ChannelSKU, mlQty, localQty)
					_, _ = s.db.Exec(ctx, `
						INSERT INTO notifications (organization_id, type, title, message, severity, created_at)
						VALUES ($1, 'stock_alert', 'Divergência de Estoque ML', $2, $3, NOW())
					`, orgID, msg, severity)
				}
			}
		}
		resp.Body.Close()

		// Atualizar last_synced_at
		for _, it := range chunk {
			_, _ = s.db.Exec(ctx, `
				UPDATE channel_stock SET last_synced_at = NOW() WHERE id = $1
			`, it.ID)
		}

		time.Sleep(200 * time.Millisecond) // Rate limiting amigável
	}

	status := "completed"
	msg := fmt.Sprintf("Verificados %d itens. %d divergências encontradas (%d corrigidas no ML Full).", processedCount, divergencesFound, fixedCount)
	s.updateSyncLog(ctx, logID, status, processedCount, msg)
}

func (s *StockReconcileService) updateSyncLog(ctx context.Context, logID, status string, records int, msg string) {
	_, _ = s.db.Exec(ctx, `
		UPDATE sync_logs 
		SET status = $1, records_processed = $2, error_message = $3, finished_at = NOW() 
		WHERE id = $4
	`, status, records, msg, logID)
}
