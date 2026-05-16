package jobs

import (
	"context"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"net/url"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/pedrohedro/economia-go/internal/config"
)

type TokenRefreshService struct {
	db *pgxpool.Pool
}

func NewTokenRefreshService(db *pgxpool.Pool) *TokenRefreshService {
	return &TokenRefreshService{db: db}
}

// RefreshAll renova os tokens OAuth do Mercado Livre que expiram em menos de 1 hora
func (s *TokenRefreshService) RefreshAll() {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	cfg := config.Load()
	if cfg.MLClientID == "" || cfg.MLClientSecret == "" {
		log.Println("[CRON] Token refresh ignorado: ML_CLIENT_ID não configurado.")
		return
	}

	log.Println("[CRON] Iniciando renovação de tokens Mercado Livre...")

	rows, err := s.db.Query(ctx, `
		SELECT id, organization_id, refresh_token 
		FROM marketplace_integrations 
		WHERE marketplace = 'mercado_livre' AND status = 'active' AND token_expires_at < NOW() + INTERVAL '1 hour'
	`)
	if err != nil {
		log.Printf("[CRON] Erro ao buscar integrações para refresh: %v", err)
		return
	}
	defer rows.Close()

	type ExpInfo struct {
		ID           string
		OrgID        string
		RefreshToken string
	}
	var expiring []ExpInfo
	for rows.Next() {
		var e ExpInfo
		if err := rows.Scan(&e.ID, &e.OrgID, &e.RefreshToken); err == nil && e.RefreshToken != "" {
			expiring = append(expiring, e)
		}
	}
	rows.Close()

	for _, exp := range expiring {
		s.refreshToken(ctx, cfg, exp.ID, exp.OrgID, exp.RefreshToken)
	}

	log.Println("[CRON] Concluída renovação de tokens Mercado Livre.")
}

func (s *TokenRefreshService) refreshToken(ctx context.Context, cfg *config.Config, intgID, orgID, refresh string) {
	data := url.Values{}
	data.Set("grant_type", "refresh_token")
	data.Set("client_id", cfg.MLClientID)
	data.Set("client_secret", cfg.MLClientSecret)
	data.Set("refresh_token", refresh)

	resp, err := http.PostForm("https://api.mercadolibre.com/oauth/token", data)
	if err != nil {
		log.Printf("Erro de comunicação no refresh do token para intg %s: %v", intgID, err)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		log.Printf("Falha ao renovar token intg %s (Status %d): %s", intgID, resp.StatusCode, string(respBody))

		// Atualizar status para token_expired e notificar usuário
		_, _ = s.db.Exec(ctx, `
			UPDATE marketplace_integrations 
			SET status = 'disconnected', last_sync_error = $1, updated_at = NOW() 
			WHERE id = $2
		`, "Token expirado ou revogado. Por favor, reconecte no menu Configurações.", intgID)

		_, _ = s.db.Exec(ctx, `
			INSERT INTO notifications (organization_id, type, title, message, severity, created_at)
			VALUES ($1, 'system_alert', 'Integração ML Desconectada', 'O token de autorização do Mercado Livre expirou. Reconecte sua conta em Configurações.', 'high', NOW())
		`, orgID)

		_, _ = s.db.Exec(ctx, `
			INSERT INTO sync_logs (integration_id, organization_id, event_type, status, error_message, started_at, finished_at)
			VALUES ($1, $2, 'token_refresh', 'failed', 'Token OAuth revogado ou expirado', NOW(), NOW())
		`, intgID, orgID)
		return
	}

	var res struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		ExpiresIn    int    `json:"expires_in"`
	}
	if json.NewDecoder(resp.Body).Decode(&res) == nil && res.AccessToken != "" {
		newExpiresAt := time.Now().Add(time.Duration(res.ExpiresIn) * time.Second)

		_, err := s.db.Exec(ctx, `
			UPDATE marketplace_integrations 
			SET access_token = $1, refresh_token = $2, token_expires_at = $3, status = 'active', last_sync_error = NULL, updated_at = NOW() 
			WHERE id = $4
		`, res.AccessToken, res.RefreshToken, newExpiresAt, intgID)

		if err == nil {
			_, _ = s.db.Exec(ctx, `
				INSERT INTO sync_logs (integration_id, organization_id, event_type, status, started_at, finished_at)
				VALUES ($1, $2, 'token_refresh', 'completed', NOW(), NOW())
			`, intgID, orgID)
			log.Printf("✓ Token renovado com sucesso para a integração %s", intgID)
		}
	}
}
