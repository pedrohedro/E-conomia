package partials

import (
	"fmt"
	"html/template"
	"log"
	"net/http"
	"path/filepath"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/pedrohedro/economia-go/internal/middleware"
)

type Partial struct {
	db    *pgxpool.Pool
	tmpls *template.Template
}

func New(pool *pgxpool.Pool) *Partial {
	tmpls := template.Must(template.ParseGlob(filepath.Join("templates", "partials", "*.html")))
	return &Partial{db: pool, tmpls: tmpls}
}

// DashboardKPIs returns HTML partial for KPI cards (used by HTMX).
func (p *Partial) DashboardKPIs(w http.ResponseWriter, r *http.Request) {
	orgID := middleware.GetOrgID(r.Context())
	mp := r.URL.Query().Get("mp")

	now := time.Now()
	startOfMonth := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)

	query := `
		SELECT COALESCE(SUM(gross_amount), 0), COALESCE(SUM(marketplace_fee_amt), 0), COUNT(*)
		FROM orders
		WHERE organization_id = $1 AND created_at >= $2 AND status != 'cancelled'
	`
	args := []any{orgID, startOfMonth}
	if mp != "" {
		query += " AND marketplace = $3"
		args = append(args, mp)
	}

	var revenue, fees float64
	var count int
	p.db.QueryRow(r.Context(), query, args...).Scan(&revenue, &fees, &count)

	data := map[string]any{
		"Revenue":     fmt.Sprintf("R$ %.0f", revenue),
		"Fees":        fmt.Sprintf("R$ %.0f", fees),
		"OrdersCount": count,
	}

	w.Header().Set("Content-Type", "text/html")
	if err := p.tmpls.ExecuteTemplate(w, "kpis.html", data); err != nil {
		log.Printf("Partial KPI error: %v", err)
	}
}

// StockAlerts returns HTML partial for stock alert rows.
func (p *Partial) StockAlerts(w http.ResponseWriter, r *http.Request) {
	orgID := middleware.GetOrgID(r.Context())

	rows, err := p.db.Query(r.Context(), `
		SELECT name, sku, total_stock, stock_alert, margin_percent
		FROM products
		WHERE organization_id = $1 AND is_active = true
		ORDER BY total_stock ASC LIMIT 8
	`, orgID)
	if err != nil {
		http.Error(w, "Error", 500)
		return
	}
	defer rows.Close()

	type Alert struct {
		Name      string
		SKU       string
		Stock     int
		Alert     string
		MarginPct float64
	}
	var alerts []Alert
	for rows.Next() {
		var a Alert
		rows.Scan(&a.Name, &a.SKU, &a.Stock, &a.Alert, &a.MarginPct)
		alerts = append(alerts, a)
	}

	w.Header().Set("Content-Type", "text/html")
	p.tmpls.ExecuteTemplate(w, "stock-alerts.html", alerts)
}

// EstoqueTable returns HTML partial for the full stock table (filtered).
func (p *Partial) EstoqueTable(w http.ResponseWriter, r *http.Request) {
	orgID := middleware.GetOrgID(r.Context())
	search := r.URL.Query().Get("search")
	filter := r.URL.Query().Get("filter")

	query := `
		SELECT name, sku, total_stock, stock_alert, sale_price, margin_percent
		FROM products
		WHERE organization_id = $1 AND is_active = true
	`
	args := []any{orgID}
	idx := 2

	if search != "" {
		query += fmt.Sprintf(" AND name ILIKE $%d", idx)
		args = append(args, "%"+search+"%")
		idx++
	}
	switch filter {
	case "critical":
		query += " AND stock_alert IN ('critical','low','out_of_stock')"
	case "ok":
		query += " AND stock_alert = 'normal' AND total_stock > 0"
	case "empty":
		query += " AND total_stock = 0"
	}
	query += " ORDER BY total_stock ASC LIMIT 200"

	rows, err := p.db.Query(r.Context(), query, args...)
	if err != nil {
		http.Error(w, "Error", 500)
		return
	}
	defer rows.Close()

	type Row struct {
		Name      string
		SKU       string
		Stock     int
		Alert     string
		Price     float64
		MarginPct float64
	}
	var products []Row
	for rows.Next() {
		var r Row
		rows.Scan(&r.Name, &r.SKU, &r.Stock, &r.Alert, &r.Price, &r.MarginPct)
		products = append(products, r)
	}

	w.Header().Set("Content-Type", "text/html")
	p.tmpls.ExecuteTemplate(w, "estoque-table.html", products)
}
