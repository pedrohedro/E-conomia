package handlers

import (
	"context"
	"fmt"
	"html/template"
	"log"
	"math"
	"net/http"
	"path/filepath"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/pedrohedro/economia-go/internal/middleware"
)

type Handler struct {
	db    *pgxpool.Pool
	pages map[string]*template.Template
}

func New(pool *pgxpool.Pool) *Handler {
	pages := make(map[string]*template.Template)
	baseLayout := filepath.Join("templates", "layouts", "base.html")

	pages["dashboard"] = template.Must(template.ParseFiles(baseLayout, filepath.Join("templates", "pages", "dashboard.html")))
	pages["estoque"] = template.Must(template.ParseFiles(baseLayout, filepath.Join("templates", "pages", "estoque.html")))
	pages["pedidos"] = template.Must(template.ParseFiles(baseLayout, filepath.Join("templates", "pages", "pedidos.html")))
	pages["vendas"] = template.Must(template.ParseFiles(baseLayout, filepath.Join("templates", "pages", "vendas.html")))
	pages["marketplaces"] = template.Must(template.ParseFiles(baseLayout, filepath.Join("templates", "pages", "marketplaces.html")))
	pages["contabil"] = template.Must(template.ParseFiles(baseLayout, filepath.Join("templates", "pages", "contabil.html")))
	pages["settings"] = template.Must(template.ParseFiles(baseLayout, filepath.Join("templates", "pages", "settings.html")))

	return &Handler{db: pool, pages: pages}
}

// DashboardData holds all data needed to render the dashboard page.
type DashboardData struct {
	PageTitle    string
	UserEmail    string
	UserInitials string
	OrgName      string
	KPIs         DashboardKPIs
	ChartData    []float64
	StockAlerts  []ProductAlert
	Integrations []IntegrationInfo
}

type DashboardKPIs struct {
	Revenue     string
	RevenueRaw  float64
	Variation   string
	Fees        string
	FeePercent  string
	OrdersCount int
}

type ProductAlert struct {
	Name       string
	SKU        string
	TotalStock int
	StockAlert string
	MarginPct  float64
}

type IntegrationInfo struct {
	Marketplace string
	Status      string
}

func (h *Handler) Dashboard(w http.ResponseWriter, r *http.Request) {
	orgID := middleware.GetOrgID(r.Context())
	ctx := r.Context()

	kpis := h.fetchDashboardKPIs(ctx, orgID)
	chartData := h.fetchMonthlyRevenue(ctx, orgID)
	alerts := h.fetchStockAlerts(ctx, orgID, 8)
	integrations := h.fetchActiveIntegrations(ctx, orgID)

	data := DashboardData{
		PageTitle:    "Dashboard",
		KPIs:         kpis,
		ChartData:    chartData,
		StockAlerts:  alerts,
		Integrations: integrations,
	}

	if err := h.pages["dashboard"].ExecuteTemplate(w, "base", data); err != nil {
		log.Printf("Template error: %v", err)
		http.Error(w, "Internal Server Error", 500)
	}
}

// DashboardKPIs retorna apenas os cards de KPI para o HTMX
func (h *Handler) DashboardKPIs(w http.ResponseWriter, r *http.Request) {
	orgID := middleware.GetOrgID(r.Context())
	_ = r.URL.Query().Get("mp")

	kpis := h.fetchDashboardKPIs(r.Context(), orgID)
	// Se houver filtro de marketplace, poderíamos ajustar a query aqui ou passar o mp para o fetcher
	// Por enquanto vamos usar o fetcher padrão que já temos

	data := map[string]any{
		"Revenue":     kpis.Revenue,
		"Fees":        kpis.Fees,
		"OrdersCount": kpis.OrdersCount,
	}

	tmpl, err := template.ParseFiles("templates/partials/kpis.html")
	if err != nil {
		http.Error(w, "Error", 500)
		return
	}

	w.Header().Set("Content-Type", "text/html")
	tmpl.ExecuteTemplate(w, "kpis.html", data)
}

// StockAlerts retorna apenas as linhas de alerta de estoque para o HTMX
func (h *Handler) StockAlerts(w http.ResponseWriter, r *http.Request) {
	orgID := middleware.GetOrgID(r.Context())
	alerts := h.fetchStockAlerts(r.Context(), orgID, 8)

	tmpl, err := template.ParseFiles("templates/partials/stock-alerts.html")
	if err != nil {
		http.Error(w, "Error", 500)
		return
	}

	w.Header().Set("Content-Type", "text/html")
	tmpl.ExecuteTemplate(w, "stock-alerts.html", alerts)
}

func (h *Handler) fetchDashboardKPIs(ctx context.Context, orgID string) DashboardKPIs {
	now := time.Now()
	startOfMonth := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)
	lastMonthStart := startOfMonth.AddDate(0, -1, 0)

	var revenue, fees float64
	var ordersCount int

	// Current month
	err := h.db.QueryRow(ctx, `
		SELECT COALESCE(SUM(gross_amount), 0), COALESCE(SUM(marketplace_fee_amt), 0), COUNT(*)
		FROM orders
		WHERE organization_id = $1 AND created_at >= $2 AND status != 'cancelled'
	`, orgID, startOfMonth).Scan(&revenue, &fees, &ordersCount)
	if err != nil {
		log.Printf("KPI query error: %v", err)
	}

	// Last month for variation
	var lastRevenue float64
	h.db.QueryRow(ctx, `
		SELECT COALESCE(SUM(gross_amount), 0)
		FROM orders
		WHERE organization_id = $1 AND created_at >= $2 AND created_at < $3 AND status != 'cancelled'
	`, orgID, lastMonthStart, startOfMonth).Scan(&lastRevenue)

	variation := "Sem dados ant."
	if lastRevenue > 0 {
		pct := ((revenue - lastRevenue) / lastRevenue) * 100
		sign := "+"
		if pct < 0 {
			sign = ""
		}
		variation = fmt.Sprintf("%s%.1f%% vs mês ant.", sign, pct)
	}

	feePercent := 0.0
	if revenue > 0 {
		feePercent = (fees / revenue) * 100
	}

	return DashboardKPIs{
		Revenue:     formatBRL(revenue),
		RevenueRaw:  revenue,
		Variation:   variation,
		Fees:        formatBRL(fees),
		FeePercent:  fmt.Sprintf("%.1f%% de taxas", feePercent),
		OrdersCount: ordersCount,
	}
}

func (h *Handler) fetchMonthlyRevenue(ctx context.Context, orgID string) []float64 {
	monthly := make([]float64, 12)
	now := time.Now()
	start := time.Date(now.Year(), now.Month()-11, 1, 0, 0, 0, 0, time.UTC)

	rows, err := h.db.Query(ctx, `
		SELECT EXTRACT(YEAR FROM created_at)::int, EXTRACT(MONTH FROM created_at)::int, COALESCE(SUM(gross_amount), 0)
		FROM orders
		WHERE organization_id = $1 AND created_at >= $2 AND status != 'cancelled'
		GROUP BY 1, 2 ORDER BY 1, 2
	`, orgID, start)
	if err != nil {
		log.Printf("Chart query error: %v", err)
		return monthly
	}
	defer rows.Close()

	for rows.Next() {
		var year, month int
		var total float64
		if err := rows.Scan(&year, &month, &total); err == nil {
			diffMonths := (now.Year()-year)*12 + (int(now.Month()) - month)
			idx := 11 - diffMonths
			if idx >= 0 && idx < 12 {
				monthly[idx] = math.Round(total/100) / 10 // em mil
			}
		}
	}
	return monthly
}

func (h *Handler) fetchStockAlerts(ctx context.Context, orgID string, limit int) []ProductAlert {
	rows, err := h.db.Query(ctx, `
		SELECT name, sku, total_stock, stock_alert, margin_percent
		FROM products
		WHERE organization_id = $1 AND is_active = true
		ORDER BY total_stock ASC
		LIMIT $2
	`, orgID, limit)
	if err != nil {
		log.Printf("Stock alerts query error: %v", err)
		return nil
	}
	defer rows.Close()

	var alerts []ProductAlert
	for rows.Next() {
		var p ProductAlert
		if err := rows.Scan(&p.Name, &p.SKU, &p.TotalStock, &p.StockAlert, &p.MarginPct); err == nil {
			alerts = append(alerts, p)
		}
	}
	return alerts
}

func (h *Handler) fetchActiveIntegrations(ctx context.Context, orgID string) []IntegrationInfo {
	rows, err := h.db.Query(ctx, `
		SELECT marketplace, status FROM marketplace_integrations
		WHERE organization_id = $1 AND status = 'active'
	`, orgID)
	if err != nil {
		return nil
	}
	defer rows.Close()

	var integrations []IntegrationInfo
	for rows.Next() {
		var i IntegrationInfo
		if err := rows.Scan(&i.Marketplace, &i.Status); err == nil {
			integrations = append(integrations, i)
		}
	}
	return integrations
}

func formatBRL(v float64) string {
	return fmt.Sprintf("R$ %.0f", v)
}
