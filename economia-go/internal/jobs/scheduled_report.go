package jobs

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// ScheduledReportService calcula e loga métricas do dia anterior diariamente.
type ScheduledReportService struct {
	db *pgxpool.Pool
}

// NewScheduledReportService cria um novo serviço de relatório agendado.
func NewScheduledReportService(db *pgxpool.Pool) *ScheduledReportService {
	return &ScheduledReportService{db: db}
}

// dailySummary agrupa as métricas de um dia para uma organização.
type dailySummary struct {
	OrgID       string
	Date        time.Time
	Revenue     float64
	Fees        float64
	OrdersCount int
	NetProfit   float64
}

// RunDaily calcula as métricas do dia anterior para todas as organizações.
func (s *ScheduledReportService) RunDaily() {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	yesterday := time.Now().AddDate(0, 0, -1)
	dayStart := time.Date(yesterday.Year(), yesterday.Month(), yesterday.Day(), 0, 0, 0, 0, time.UTC)
	dayEnd := dayStart.AddDate(0, 0, 1)

	log.Printf("[CRON] Gerando relatório diário para %s...", dayStart.Format("2006-01-02"))

	rows, err := s.db.Query(ctx, `
		SELECT DISTINCT organization_id FROM orders
		WHERE created_at >= $1 AND created_at < $2
	`, dayStart, dayEnd)
	if err != nil {
		log.Printf("[ScheduledReport] Erro ao buscar organizações: %v", err)
		return
	}

	var orgs []string
	for rows.Next() {
		var orgID string
		if rows.Scan(&orgID) == nil {
			orgs = append(orgs, orgID)
		}
	}
	rows.Close()

	if len(orgs) == 0 {
		log.Printf("[ScheduledReport] Nenhuma organização com pedidos em %s.", dayStart.Format("2006-01-02"))
		return
	}

	for _, orgID := range orgs {
		summary := s.calcDailySummary(ctx, orgID, dayStart, dayEnd)
		s.logSummary(summary)
		// TODO: enviar relatório por e-mail ou salvar em tabela de reports quando disponível.
	}

	log.Println("[CRON] Relatório diário concluído.")
}

func (s *ScheduledReportService) calcDailySummary(ctx context.Context, orgID string, from, to time.Time) dailySummary {
	var revenue, fees float64
	var count int

	err := s.db.QueryRow(ctx, `
		SELECT
			COALESCE(SUM(gross_amount), 0),
			COALESCE(SUM(marketplace_fee_amt), 0),
			COUNT(*)
		FROM orders
		WHERE organization_id = $1
		  AND created_at >= $2
		  AND created_at < $3
		  AND status NOT IN ('cancelled', 'returned')
	`, orgID, from, to).Scan(&revenue, &fees, &count)
	if err != nil {
		log.Printf("[ScheduledReport] Erro ao calcular sumário para org %s: %v", orgID, err)
	}

	return dailySummary{
		OrgID:       orgID,
		Date:        from,
		Revenue:     revenue,
		Fees:        fees,
		OrdersCount: count,
		NetProfit:   revenue - fees,
	}
}

func (s *ScheduledReportService) logSummary(sm dailySummary) {
	log.Printf("[ScheduledReport] Org=%s Data=%s Pedidos=%d Faturamento=R$%.2f Taxas=R$%.2f LucroEstimado=R$%.2f",
		sm.OrgID,
		sm.Date.Format("2006-01-02"),
		sm.OrdersCount,
		sm.Revenue,
		sm.Fees,
		sm.NetProfit,
	)
	_ = fmt.Sprintf // silencia import lint se nécessário
}
