package handlers

import (
	"log"
	"net/http"
)

// MarketplacesPage renderiza a página de Integrações com Marketplaces
func (h *Handler) MarketplacesPage(w http.ResponseWriter, r *http.Request) {
	data := map[string]interface{}{
		"PageTitle": "Marketplaces",
	}

	if err := h.pages["marketplaces"].ExecuteTemplate(w, "base", data); err != nil {
		log.Printf("Error executing template: %v", err)
	}
}
