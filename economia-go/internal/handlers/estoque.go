package handlers

import (
	"context"
	"fmt"
	"log"
	"net/http"

	"github.com/pedrohedro/economia-go/internal/middleware"
)

type EstoqueData struct {
	PageTitle  string
	Products   []ProductRow
	Search     string
	Filter     string
	TotalCount int
}

type ProductRow struct {
	ID           string
	Name         string
	SKU          string
	SalePrice    float64
	CostPrice    float64
	MarginPct    float64
	TotalStock   int
	MinStock     int
	StockAlert   string
	IsActive     bool
	Channels     []ChannelRow
}

type ChannelRow struct {
	Channel   string
	Quantity  int
	Reserved  int
	Available int
}

func (h *Handler) Estoque(w http.ResponseWriter, r *http.Request) {
	orgID := middleware.GetOrgID(r.Context())
	ctx := r.Context()
	search := r.URL.Query().Get("search")
	filter := r.URL.Query().Get("filter")
	if filter == "" {
		filter = "all"
	}

	products := h.fetchProducts(ctx, orgID, search, filter)

	data := EstoqueData{
		PageTitle:  "Estoque",
		Products:   products,
		Search:     search,
		Filter:     filter,
		TotalCount: len(products),
	}

	if err := h.tmpls.ExecuteTemplate(w, "estoque.html", data); err != nil {
		log.Printf("Template error: %v", err)
		http.Error(w, "Internal Server Error", 500)
	}
}

func (h *Handler) fetchProducts(ctx context.Context, orgID, search, filter string) []ProductRow {
	query := `
		SELECT p.id, p.name, p.sku, p.sale_price, p.cost_price, p.margin_percent,
		       p.total_stock, p.min_stock, p.stock_alert, p.is_active
		FROM products p
		WHERE p.organization_id = $1 AND p.is_active = true
	`
	args := []any{orgID}
	argIdx := 2

	if search != "" {
		query += fmt.Sprintf(" AND p.name ILIKE $%d", argIdx)
		args = append(args, "%"+search+"%")
		argIdx++
	}

	switch filter {
	case "critical":
		query += " AND p.stock_alert IN ('critical', 'low', 'out_of_stock')"
	case "ok":
		query += " AND p.stock_alert = 'normal' AND p.total_stock > 0"
	case "empty":
		query += " AND p.total_stock = 0"
	}

	query += " ORDER BY p.stock_alert DESC, p.total_stock ASC LIMIT 200"

	rows, err := h.db.Query(ctx, query, args...)
	if err != nil {
		log.Printf("Products query error: %v", err)
		return nil
	}
	defer rows.Close()

	var products []ProductRow
	for rows.Next() {
		var p ProductRow
		if err := rows.Scan(&p.ID, &p.Name, &p.SKU, &p.SalePrice, &p.CostPrice,
			&p.MarginPct, &p.TotalStock, &p.MinStock, &p.StockAlert, &p.IsActive); err == nil {
			products = append(products, p)
		}
	}

	// Fetch channel stock for each product
	for i := range products {
		chRows, err := h.db.Query(ctx, `
			SELECT channel, quantity, reserved, available
			FROM channel_stock
			WHERE product_id = $1
		`, products[i].ID)
		if err != nil {
			continue
		}
		for chRows.Next() {
			var ch ChannelRow
			if err := chRows.Scan(&ch.Channel, &ch.Quantity, &ch.Reserved, &ch.Available); err == nil {
				products[i].Channels = append(products[i].Channels, ch)
			}
		}
		chRows.Close()
	}

	return products
}
