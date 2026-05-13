package handlers

import (
	"context"
	"html/template"
	"log"
	"net/http"
	"path/filepath"

	"github.com/pedrohedro/economia-go/internal/middleware"
	"github.com/pedrohedro/economia-go/internal/models"
)

// PedidosPage renderiza a página inteira de pedidos
func (h *Handler) PedidosPage(w http.ResponseWriter, r *http.Request) {

	data := map[string]interface{}{
		"Title": "Pedidos - E-conomia",
	}

	if err := h.pages["pedidos"].ExecuteTemplate(w, "base", data); err != nil {
		log.Printf("Error executing template: %v", err)
	}
}

// PedidosTable retorna apenas as linhas da tabela via HTMX
func (h *Handler) PedidosTable(w http.ResponseWriter, r *http.Request) {
	orgID := r.Context().Value(middleware.OrgIDKey).(string)

	status := r.URL.Query().Get("status")
	query := `
		SELECT id, order_number, marketplace, status, fulfillment, net_amount, nfe_status, created_at 
		FROM orders 
		WHERE organization_id = $1
	`
	args := []interface{}{orgID}

	if status != "" && status != "all" {
		query += ` AND status = $2`
		args = append(args, status)
	}

	query += ` ORDER BY created_at DESC LIMIT 50`

	rows, err := h.db.Query(context.Background(), query, args...)
	if err != nil {
		log.Printf("Error querying orders: %v", err)
		http.Error(w, "Erro interno", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var orders []models.Order
	for rows.Next() {
		var o models.Order
		err := rows.Scan(
			&o.ID, &o.OrderNumber, &o.Marketplace, &o.Status,
			&o.Fulfillment, &o.NetAmount, &o.NfeStatus, &o.CreatedAt,
		)
		if err != nil {
			log.Printf("Error scanning order: %v", err)
			continue
		}
		orders = append(orders, o)
	}

	tmpl, err := template.ParseFiles(filepath.Join("templates", "partials", "pedidos-table.html"))
	if err != nil {
		http.Error(w, "Template error", http.StatusInternalServerError)
		return
	}

	if err := tmpl.ExecuteTemplate(w, "pedidos-table", orders); err != nil {
		log.Printf("Error executing partial: %v", err)
	}
}
