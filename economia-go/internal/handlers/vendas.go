package handlers

import (
	"context"
	"html/template"
	"log"
	"net/http"
	"path/filepath"

	"github.com/pedrohedro/economia-go/internal/middleware"
)

// VendasPage renderiza a página inteira de relatórios de vendas
func (h *Handler) VendasPage(w http.ResponseWriter, r *http.Request) {

	data := map[string]interface{}{
		"PageTitle": "Vendas",
	}

	if err := h.pages["vendas"].ExecuteTemplate(w, "base", data); err != nil {
		log.Printf("Error executing template: %v", err)
	}
}

// VendasReport retorna os totais financeiros via HTMX
func (h *Handler) VendasReport(w http.ResponseWriter, r *http.Request) {
	orgID := r.Context().Value(middleware.OrgIDKey).(string)

	query := `
		SELECT 
			COALESCE(SUM(gross_amount), 0) as total_gross,
			COALESCE(SUM(marketplace_fee_amt), 0) as total_fees,
			COALESCE(SUM(shipping_cost), 0) as total_shipping,
			COALESCE(SUM(net_amount), 0) as total_net,
			COUNT(id) as total_orders
		FROM orders
		WHERE organization_id = $1 AND status NOT IN ('cancelled', 'returned')
	`

	var gross, fees, shipping, net float64
	var count int

	err := h.db.QueryRow(context.Background(), query, orgID).Scan(&gross, &fees, &shipping, &net, &count)
	if err != nil {
		log.Printf("Error querying sales report: %v", err)
		http.Error(w, "Erro interno", http.StatusInternalServerError)
		return
	}

	data := map[string]interface{}{
		"Gross":    gross,
		"Fees":     fees,
		"Shipping": shipping,
		"Net":      net,
		"Count":    count,
	}

	tmpl, err := template.ParseFiles(filepath.Join("templates", "partials", "vendas-report.html"))
	if err != nil {
		http.Error(w, "Template error", http.StatusInternalServerError)
		return
	}

	if err := tmpl.ExecuteTemplate(w, "vendas-report", data); err != nil {
		log.Printf("Error executing partial: %v", err)
	}
}
