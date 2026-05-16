package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/pedrohedro/economia-go/internal/middleware"
)

// StockPushHandler empurra itens com estoque pendente de sincronização para o ML.
// Rota sugerida: POST /webhooks/stock-push (protegida por auth)
func (h *Handler) StockPushML(w http.ResponseWriter, r *http.Request) {
	orgID := middleware.GetOrgID(r.Context())
	ctx := r.Context()

	pushed, failed := h.pushPendingStockForOrg(ctx, orgID)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"pushed": pushed,
		"failed": failed,
	})
}

// pushPendingStockForOrg busca itens cujo last_synced_at é nulo ou muito antigo
// e empurra a quantidade disponível para o Mercado Livre.
func (h *Handler) pushPendingStockForOrg(ctx context.Context, orgID string) (pushed, failed int) {
	// Buscar token ativo da integração ML
	var accessToken string
	err := h.db.QueryRow(ctx, `
		SELECT access_token
		FROM marketplace_integrations
		WHERE organization_id = $1
		  AND marketplace = 'mercado_livre'
		  AND status = 'active'
		LIMIT 1
	`, orgID).Scan(&accessToken)
	if err != nil {
		log.Printf("[StockPush] Sem integração ML ativa para org %s: %v", orgID, err)
		return
	}

	// Busca itens pendentes: sem sincronização recente (> 1h) ou nunca sincronizados
	// TODO: adicionar coluna sync_status em channel_stock se necessário para controle mais fino
	rows, err := h.db.Query(ctx, `
		SELECT cs.id, cs.channel_sku, cs.available, p.name
		FROM channel_stock cs
		JOIN products p ON cs.product_id = p.id
		WHERE cs.organization_id = $1
		  AND cs.channel IN ('ml_full', 'ml_flex')
		  AND cs.channel_sku IS NOT NULL
		  AND (cs.last_synced_at IS NULL OR cs.last_synced_at < NOW() - INTERVAL '1 hour')
		ORDER BY cs.last_synced_at ASC NULLS FIRST
		LIMIT 50
	`, orgID)
	if err != nil {
		log.Printf("[StockPush] Erro ao buscar itens pendentes org %s: %v", orgID, err)
		return
	}
	defer rows.Close()

	type pendingItem struct {
		ID         string
		ChannelSKU string
		Available  int
		ProdName   string
	}

	var items []pendingItem
	for rows.Next() {
		var it pendingItem
		if rows.Scan(&it.ID, &it.ChannelSKU, &it.Available, &it.ProdName) == nil {
			items = append(items, it)
		}
	}
	rows.Close()

	if len(items) == 0 {
		log.Printf("[StockPush] Nenhum item pendente para org %s", orgID)
		return
	}

	client := &http.Client{Timeout: 10 * time.Second}

	for _, it := range items {
		if err := pushItemToML(ctx, client, accessToken, it.ChannelSKU, it.Available); err != nil {
			log.Printf("[StockPush] Falha ao empurrar %s (%s): %v", it.ProdName, it.ChannelSKU, err)
			failed++
			continue
		}

		_, _ = h.db.Exec(ctx, `
			UPDATE channel_stock SET last_synced_at = NOW(), updated_at = NOW() WHERE id = $1
		`, it.ID)

		log.Printf("[StockPush] OK: %s (%s) => qty %d", it.ProdName, it.ChannelSKU, it.Available)
		pushed++
	}

	return
}

// pushItemToML chama PUT /items/{id} na API do ML para atualizar available_quantity.
func pushItemToML(ctx context.Context, client *http.Client, token, mlItemID string, qty int) error {
	body, _ := json.Marshal(map[string]int{"available_quantity": qty})

	url := fmt.Sprintf("https://api.mercadolibre.com/items/%s", mlItemID)
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, url, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("criar request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("chamada ML: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return fmt.Errorf("ML retornou status %d", resp.StatusCode)
	}
	return nil
}
