package handlers

import (
	"fmt"
	"log"
	"net/http"
	"net/url"

	"github.com/pedrohedro/economia-go/internal/config"
	"github.com/pedrohedro/economia-go/internal/middleware"
	"github.com/pedrohedro/economia-go/internal/models"
)

type SettingsData struct {
	PageTitle    string
	Organization models.Organization
	Integrations map[string]models.Integration
	MLAuthURL    string
}

// GetSettings renderiza a página de Configurações
func (h *Handler) GetSettings(w http.ResponseWriter, r *http.Request) {
	orgID := r.Context().Value(middleware.OrgIDKey).(string)
	cfg := config.Load()

	// 1. Fetch organization details
	var org models.Organization
	err := h.db.QueryRow(r.Context(), `
		SELECT id, name, slug, cnpj, tax_regime, tax_rate 
		FROM organizations 
		WHERE id = $1
	`, orgID).Scan(&org.ID, &org.Name, &org.Slug, &org.CNPJ, &org.TaxRegime, &org.TaxRate)

	if err != nil {
		log.Printf("Error querying organization for settings: %v", err)
		http.Error(w, "Erro ao carregar dados da organização", http.StatusInternalServerError)
		return
	}

	// 2. Fetch marketplace integrations
	rows, err := h.db.Query(r.Context(), `
		SELECT id, marketplace, status, seller_nickname, last_sync_at 
		FROM marketplace_integrations 
		WHERE organization_id = $1
	`, orgID)

	integrations := make(map[string]models.Integration)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var i models.Integration
			err := rows.Scan(&i.ID, &i.Marketplace, &i.Status, &i.SellerNickname, &i.LastSyncAt)
			if err == nil {
				integrations[i.Marketplace] = i
			}
		}
	} else {
		log.Printf("Error querying integrations: %v", err)
	}

	// 3. Build Mercado Livre OAuth URL
	// Rota de callback configurada para a nossa aplicação
	redirectURI := fmt.Sprintf("https://%s/webhooks/ml/callback", r.Host)
	if r.Host == "localhost" || r.Host == "" {
		redirectURI = "https://economia-app-z95f.onrender.com/webhooks/ml/callback"
	}
	mlURL := fmt.Sprintf("https://auth.mercadolivre.com.br/authorization?response_type=code&client_id=%s&redirect_uri=%s",
		url.QueryEscape(cfg.MLClientID), url.QueryEscape(redirectURI))

	data := SettingsData{
		PageTitle:    "Configurações",
		Organization: org,
		Integrations: integrations,
		MLAuthURL:    mlURL,
	}

	if err := h.pages["settings"].ExecuteTemplate(w, "base", data); err != nil {
		log.Printf("Error executing settings template: %v", err)
	}
}

// UpdateOrg salva as alterações cadastrais da empresa via HTMX
func (h *Handler) UpdateOrg(w http.ResponseWriter, r *http.Request) {
	orgID := r.Context().Value(middleware.OrgIDKey).(string)

	if err := r.ParseForm(); err != nil {
		http.Error(w, "Bad request", http.StatusBadRequest)
		return
	}

	name := r.FormValue("name")
	cnpj := r.FormValue("cnpj")
	taxRegime := r.FormValue("tax_regime")

	if name == "" {
		http.Error(w, "Nome é obrigatório", http.StatusBadRequest)
		return
	}

	_, err := h.db.Exec(r.Context(), `
		UPDATE organizations 
		SET name = $1, cnpj = $2, tax_regime = $3, updated_at = NOW() 
		WHERE id = $4
	`, name, cnpj, taxRegime, orgID)

	if err != nil {
		log.Printf("Error updating organization: %v", err)
		w.Header().Set("Content-Type", "text/html")
		fmt.Fprintf(w, `<div class="toast" style="border-left: 4px solid var(--destructive); background: var(--destructive); color: #fff;">Erro ao salvar alterações.</div>`)
		return
	}

	w.Header().Set("Content-Type", "text/html")
	fmt.Fprintf(w, `<div class="toast" style="border-left: 4px solid var(--success); background: var(--success); color: #fff;">Configurações salvas com sucesso!</div>`)
}

// DisconnectIntegration desconecta uma integração via HTMX
func (h *Handler) DisconnectIntegration(w http.ResponseWriter, r *http.Request) {
	orgID := r.Context().Value(middleware.OrgIDKey).(string)
	mp := r.URL.Query().Get("mp")

	if mp != "" {
		_, err := h.db.Exec(r.Context(), `
			DELETE FROM marketplace_integrations 
			WHERE organization_id = $1 AND marketplace = $2
		`, orgID, mp)
		if err != nil {
			log.Printf("Error deleting integration %s: %v", mp, err)
		} else {
			log.Printf("Integration %s disconnected for org %s", mp, orgID)
		}
	}

	// Re-render settings page to update UI
	h.GetSettings(w, r)
}
