package handlers

import (
	"context"
	"fmt"
	"html/template"
	"log"
	"net/http"
	"path/filepath"
	"time"

	"github.com/pedrohedro/economia-go/internal/middleware"
)

// ContabilKPIs holds the financial KPIs for the current month.
type ContabilKPIs struct {
	Revenue        string
	Fees           string
	CMV            string
	NetProfit      string
	CashBalance    string
	PendingPayable string
	PayoutsMonth   string
}

// CashFlowEntry represents a single financial movement row.
type CashFlowEntry struct {
	ID          string
	EntryDate   time.Time
	EntryType   string // "income" | "expense"
	Amount      float64
	Description string
	Status      string // "confirmed" | "pending"
}

// ContabilPage renders the full contábil page (initial load).
func (h *Handler) ContabilPage(w http.ResponseWriter, r *http.Request) {
	data := map[string]interface{}{
		"PageTitle": "Contábil",
	}

	if err := h.pages["contabil"].ExecuteTemplate(w, "base", data); err != nil {
		log.Printf("Error executing contabil template: %v", err)
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
	}
}

// ContabilSummary returns KPIs and recent movements via HTMX partial.
func (h *Handler) ContabilSummary(w http.ResponseWriter, r *http.Request) {
	orgID := middleware.GetOrgID(r.Context())
	ctx := r.Context()

	kpis := h.fetchContabilKPIs(ctx, orgID)
	entries := h.fetchCashFlowEntries(ctx, orgID)

	data := map[string]interface{}{
		"KPIs":    kpis,
		"Entries": entries,
	}

	tmpl, err := template.ParseFiles(filepath.Join("templates", "partials", "contabil-summary.html"))
	if err != nil {
		log.Printf("Contabil partial template error: %v", err)
		http.Error(w, "Template error", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/html")
	if err := tmpl.ExecuteTemplate(w, "contabil-summary", data); err != nil {
		log.Printf("Error executing contabil-summary partial: %v", err)
	}
}

func (h *Handler) fetchContabilKPIs(ctx context.Context, orgID string) ContabilKPIs {
	now := time.Now()
	startOfMonth := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)

	// Faturamento bruto + taxas do mês (via orders)
	var revenue, fees, cmv float64
	err := h.db.QueryRow(ctx, `
		SELECT
			COALESCE(SUM(gross_amount), 0),
			COALESCE(SUM(marketplace_fee_amt), 0),
			COALESCE(SUM(shipping_cost), 0)
		FROM orders
		WHERE organization_id = $1
		  AND created_at >= $2
		  AND status NOT IN ('cancelled', 'returned')
	`, orgID, startOfMonth).Scan(&revenue, &fees, &cmv)
	if err != nil {
		log.Printf("ContabilKPIs revenue query error: %v", err)
	}

	// Lucro líquido estimado = faturamento - taxas - custo logístico (shipping como proxy CMV)
	netProfit := revenue - fees - cmv

	// Saldo de repasses recebidos no mês
	var payoutsMonth float64
	h.db.QueryRow(ctx, `
		SELECT COALESCE(SUM(net_amount), 0)
		FROM marketplace_payouts
		WHERE organization_id = $1 AND payout_date >= $2
	`, orgID, startOfMonth).Scan(&payoutsMonth)

	// Contas a pagar pendentes (vencimento no mês atual)
	endOfMonth := time.Date(now.Year(), now.Month()+1, 1, 0, 0, 0, 0, time.UTC)
	var pendingPayable float64
	h.db.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount), 0)
		FROM expenses
		WHERE organization_id = $1
		  AND is_paid = false
		  AND due_date >= $2
		  AND due_date < $3
	`, orgID, startOfMonth, endOfMonth).Scan(&pendingPayable)

	// Saldo de caixa acumulado: repasses confirmados - despesas pagas
	var totalPayouts, totalExpensesPaid float64
	h.db.QueryRow(ctx, `
		SELECT COALESCE(SUM(net_amount), 0)
		FROM marketplace_payouts
		WHERE organization_id = $1 AND is_confirmed = true
	`, orgID).Scan(&totalPayouts)

	h.db.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount), 0)
		FROM expenses
		WHERE organization_id = $1 AND is_paid = true
	`, orgID).Scan(&totalExpensesPaid)

	cashBalance := totalPayouts - totalExpensesPaid

	return ContabilKPIs{
		Revenue:        formatBRL(revenue),
		Fees:           fmt.Sprintf("%s (%.1f%%)", formatBRL(fees), safePercent(fees, revenue)),
		CMV:            formatBRL(cmv),
		NetProfit:      formatBRL(netProfit),
		CashBalance:    formatBRL(cashBalance),
		PendingPayable: formatBRL(pendingPayable),
		PayoutsMonth:   formatBRL(payoutsMonth),
	}
}

// fetchCashFlowEntries returns the 30 most recent financial movements,
// combining marketplace_payouts (income) and expenses (debit).
func (h *Handler) fetchCashFlowEntries(ctx context.Context, orgID string) []CashFlowEntry {
	// TODO: if a dedicated cash_flow_entries table is added, replace this union query.
	rows, err := h.db.Query(ctx, `
		SELECT id::text, payout_date, 'income'::text, net_amount,
		       marketplace::text || ' — repasse', is_confirmed
		FROM marketplace_payouts
		WHERE organization_id = $1

		UNION ALL

		SELECT id::text, due_date, 'expense'::text, amount,
		       description, is_paid
		FROM expenses
		WHERE organization_id = $2

		ORDER BY 2 DESC, 1
		LIMIT 30
	`, orgID, orgID)
	if err != nil {
		log.Printf("fetchCashFlowEntries query error: %v", err)
		return nil
	}
	defer rows.Close()

	var entries []CashFlowEntry
	for rows.Next() {
		var e CashFlowEntry
		var isConfirmed bool
		var entryDate time.Time
		if err := rows.Scan(&e.ID, &entryDate, &e.EntryType, &e.Amount, &e.Description, &isConfirmed); err != nil {
			log.Printf("fetchCashFlowEntries scan error: %v", err)
			continue
		}
		e.EntryDate = entryDate
		if isConfirmed {
			e.Status = "confirmed"
		} else {
			e.Status = "pending"
		}
		entries = append(entries, e)
	}
	return entries
}

func safePercent(part, total float64) float64 {
	if total == 0 {
		return 0
	}
	return (part / total) * 100
}
