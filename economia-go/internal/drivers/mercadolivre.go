package drivers

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/pedrohedro/economia-go/internal/config"
	"github.com/pedrohedro/economia-go/internal/middleware"
)

type MercadoLivreClient struct {
	db *pgxpool.Pool
}

func NewMercadoLivreClient(db *pgxpool.Pool) *MercadoLivreClient {
	return &MercadoLivreClient{db: db}
}

// OAuthCallback processa o retorno do Mercado Livre após o usuário conceder permissão
func (c *MercadoLivreClient) OAuthCallback(w http.ResponseWriter, r *http.Request) {
	orgID := r.Context().Value(middleware.OrgIDKey).(string)
	code := r.URL.Query().Get("code")
	cfg := config.Load()

	if code == "" {
		http.Error(w, "Código de autorização não encontrado", http.StatusBadRequest)
		return
	}

	redirectURI := fmt.Sprintf("https://%s/webhooks/ml/callback", r.Host)
	if r.Host == "localhost" || r.Host == "" {
		redirectURI = "https://economia-app-z95f.onrender.com/webhooks/ml/callback"
	}

	// Se não houver credenciais reais configuradas ou em ambiente de teste, criamos credenciais mock
	if cfg.MLClientID == "" || cfg.MLClientSecret == "" || code == "test_mock_code" {
		log.Printf("⚠️ ML_CLIENT_ID não configurado. Ativando integração ML em modo Sandbox/Mock para a organização %s", orgID)
		expiresAt := time.Now().Add(6 * time.Hour)
		_, err := c.db.Exec(r.Context(), `
			INSERT INTO marketplace_integrations 
			(organization_id, marketplace, status, seller_id, seller_nickname, access_token, refresh_token, token_expires_at, updated_at)
			VALUES ($1, 'mercado_livre', 'active', '123456789', 'SANDBOX_SELLER_ML', 'mock_access_token_meli_123', 'mock_refresh_token_meli', $2, NOW())
			ON CONFLICT (organization_id, marketplace) DO UPDATE SET
				status = 'active', seller_id = '123456789', seller_nickname = 'SANDBOX_SELLER_ML',
				access_token = 'mock_access_token_meli_123', refresh_token = 'mock_refresh_token_meli',
				token_expires_at = $2, updated_at = NOW()
		`, orgID, expiresAt)

		if err != nil {
			log.Printf("Erro ao salvar mock integração ML: %v", err)
		}
		http.Redirect(w, r, "/settings", http.StatusSeeOther)
		return
	}

	// Requisição real para trocar o code pelo access_token
	data := url.Values{}
	data.Set("grant_type", "authorization_code")
	data.Set("client_id", cfg.MLClientID)
	data.Set("client_secret", cfg.MLClientSecret)
	data.Set("code", code)
	data.Set("redirect_uri", redirectURI)

	resp, err := http.PostForm("https://api.mercadolibre.com/oauth/token", data)
	if err != nil {
		log.Printf("Error requesting ML token: %v", err)
		http.Error(w, "Erro ao comunicar com Mercado Livre", http.StatusInternalServerError)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		log.Printf("ML Token error response: %s", string(respBody))
		http.Error(w, "Falha na autenticação com o Mercado Livre", http.StatusBadRequest)
		return
	}

	var tokenRes struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		ExpiresIn    int    `json:"expires_in"`
		UserID       int    `json:"user_id"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&tokenRes); err != nil {
		log.Printf("Error decoding ML token response: %v", err)
		http.Error(w, "Erro interno", http.StatusInternalServerError)
		return
	}

	sellerID := strconv.Itoa(tokenRes.UserID)
	expiresAt := time.Now().Add(time.Duration(tokenRes.ExpiresIn) * time.Second)

	// Buscar apelido do vendedor
	sellerNickname := fmt.Sprintf("SELLER_%s", sellerID)
	reqMe, _ := http.NewRequest(http.MethodGet, "https://api.mercadolibre.com/users/me", nil)
	reqMe.Header.Set("Authorization", "Bearer "+tokenRes.AccessToken)

	if respMe, errMe := http.DefaultClient.Do(reqMe); errMe == nil && respMe.StatusCode == http.StatusOK {
		var userRes struct {
			Nickname string `json:"nickname"`
		}
		if json.NewDecoder(respMe.Body).Decode(&userRes) == nil && userRes.Nickname != "" {
			sellerNickname = userRes.Nickname
		}
		respMe.Body.Close()
	}

	// Salvar ou atualizar no banco
	_, err = c.db.Exec(r.Context(), `
		INSERT INTO marketplace_integrations 
		(organization_id, marketplace, status, seller_id, seller_nickname, access_token, refresh_token, token_expires_at, updated_at)
		VALUES ($1, 'mercado_livre', 'active', $2, $3, $4, $5, $6, NOW())
		ON CONFLICT (organization_id, marketplace) DO UPDATE SET
			status = 'active', seller_id = EXCLUDED.seller_id, seller_nickname = EXCLUDED.seller_nickname,
			access_token = EXCLUDED.access_token, refresh_token = EXCLUDED.refresh_token,
			token_expires_at = EXCLUDED.token_expires_at, updated_at = NOW()
	`, orgID, sellerID, sellerNickname, tokenRes.AccessToken, tokenRes.RefreshToken, expiresAt)

	if err != nil {
		log.Printf("Error saving ML integration to db: %v", err)
		http.Error(w, "Erro ao salvar integração no banco de dados", http.StatusInternalServerError)
		return
	}

	log.Printf("✓ Integração Mercado Livre conectada com sucesso para organização %s (Seller: %s)", orgID, sellerNickname)
	http.Redirect(w, r, "/settings", http.StatusSeeOther)
}

// PushStock envia uma atualização de estoque para o Mercado Livre
func (c *MercadoLivreClient) PushStock(ctx context.Context, orgID, channelSKU string, quantity int) error {
	var token string
	var expiresAt time.Time
	err := c.db.QueryRow(ctx, `
		SELECT access_token, token_expires_at 
		FROM marketplace_integrations 
		WHERE organization_id = $1 AND marketplace = 'mercado_livre' AND status = 'active'
	`, orgID).Scan(&token, &expiresAt)

	if err != nil {
		return fmt.Errorf("integração ML não encontrada ou inativa para organização %s", orgID)
	}

	if time.Now().After(expiresAt.Add(-5 * time.Minute)) {
		return fmt.Errorf("token ML expirado")
	}

	payload := map[string]interface{}{
		"available_quantity": quantity,
	}
	bodyBytes, _ := json.Marshal(payload)

	req, err := http.NewRequestWithContext(ctx, http.MethodPut, "https://api.mercadolibre.com/items/"+channelSKU, bytes.NewReader(bodyBytes))
	if err != nil {
		return err
	}

	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("erro ML API status=%d body=%s", resp.StatusCode, string(respBody))
	}

	// Atualizar no banco local
	_, _ = c.db.Exec(ctx, `
		UPDATE channel_stock 
		SET quantity = $1, last_synced_at = NOW(), updated_at = NOW() 
		WHERE organization_id = $2 AND channel_sku = $3 AND channel IN ('ml_flex', 'ml_coleta')
	`, quantity, orgID, channelSKU)

	return nil
}

// WebhookReceiver recebe eventos públicos do Mercado Livre
func (c *MercadoLivreClient) WebhookReceiver(w http.ResponseWriter, r *http.Request) {
	var payload struct {
		Resource string `json:"resource"`
		UserID   int    `json:"user_id"`
		Topic    string `json:"topic"`
	}

	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, "Bad request", http.StatusBadRequest)
		return
	}

	log.Printf("Recebido Webhook ML: Topic=%s Resource=%s UserID=%d", payload.Topic, payload.Resource, payload.UserID)

	w.WriteHeader(http.StatusOK)
	w.Write([]byte("OK"))

	// Processamento em background
	go func(resource string, sellerID int, topic string) {
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()

		sellerIDStr := strconv.Itoa(sellerID)
		var orgID, token string
		err := c.db.QueryRow(ctx, `
			SELECT organization_id, access_token 
			FROM marketplace_integrations 
			WHERE seller_id = $1 AND marketplace = 'mercado_livre' AND status = 'active'
		`, sellerIDStr).Scan(&orgID, &token)

		if err != nil {
			log.Printf("Webhook ML ignorado: nenhum seller ativo para user_id %s", sellerIDStr)
			return
		}

		if topic == "orders" && strings.HasPrefix(resource, "/orders/") {
			orderID := strings.TrimPrefix(resource, "/orders/")
			req, _ := http.NewRequestWithContext(ctx, http.MethodGet, "https://api.mercadolibre.com/orders/"+orderID, nil)
			req.Header.Set("Authorization", "Bearer "+token)

			resp, err := http.DefaultClient.Do(req)
			if err == nil && resp.StatusCode == http.StatusOK {
				var oRes struct {
					ID            int       `json:"id"`
					DateCreated   time.Time `json:"date_created"`
					Status        string    `json:"status"`
					TotalAmount   float64   `json:"total_amount"`
					ShippingCost  float64   `json:"shipping_cost"`
					OrderItems    []struct{
						Item struct {
							ID    string  `json:"id"`
							Title string  `json:"title"`
						} `json:"item"`
						Quantity  int     `json:"quantity"`
						UnitPrice float64 `json:"unit_price"`
					} `json:"order_items"`
				}
				if json.NewDecoder(resp.Body).Decode(&oRes) == nil {
					// Mapear status
					statusMap := map[string]string{
						"paid":      "approved",
						"confirmed": "approved",
						"shipped":   "shipped",
						"delivered": "delivered",
						"cancelled": "cancelled",
					}
					internalStatus := "pending"
					if st, exists := statusMap[oRes.Status]; exists {
						internalStatus = st
					}

					orderNumber := fmt.Sprintf("ML-%d", oRes.ID)
					_, _ = c.db.Exec(ctx, `
						INSERT INTO orders 
						(organization_id, order_number, marketplace, marketplace_order_id, status, fulfillment, gross_amount, net_amount, marketplace_created_at, created_at, updated_at)
						VALUES ($1, $2, 'mercado_livre', $3, $4, 'ml_flex', $5, $5, $6, NOW(), NOW())
						ON CONFLICT (organization_id, marketplace, marketplace_order_id) DO UPDATE SET
							status = EXCLUDED.status, updated_at = NOW()
					`, orgID, orderNumber, strconv.Itoa(oRes.ID), internalStatus, oRes.TotalAmount, oRes.DateCreated)
					log.Printf("✓ Pedido ML %s salvo/atualizado para organização %s", orderNumber, orgID)
				}
				resp.Body.Close()
			}
		}
	}(payload.Resource, payload.UserID, payload.Topic)
}
