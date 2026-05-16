package jobs

import (
	"context"
	"log"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// StockAlertsService verifica produtos abaixo do estoque mínimo e loga alertas.
type StockAlertsService struct {
	db *pgxpool.Pool
}

// NewStockAlertsService cria um novo serviço de alertas de estoque.
func NewStockAlertsService(db *pgxpool.Pool) *StockAlertsService {
	return &StockAlertsService{db: db}
}

// alertRow representa um produto em estado de alerta.
type alertRow struct {
	OrgID      string
	ProductID  string
	Name       string
	SKU        string
	TotalStock int
	MinStock   int
	StockAlert string
}

// CheckAll verifica alertas de estoque para todas as organizações ativas.
func (s *StockAlertsService) CheckAll() {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	log.Println("[CRON] Iniciando verificação de alertas de estoque...")

	rows, err := s.db.Query(ctx, `
		SELECT DISTINCT organization_id FROM products WHERE is_active = true
	`)
	if err != nil {
		log.Printf("[CRON][StockAlerts] Erro ao buscar organizações: %v", err)
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

	for _, orgID := range orgs {
		s.checkForOrg(ctx, orgID)
	}

	log.Println("[CRON] Concluída verificação de alertas de estoque.")
}

func (s *StockAlertsService) checkForOrg(ctx context.Context, orgID string) {
	// Produtos cujo total_stock <= min_stock (reorder_point).
	// A coluna min_stock é o equivalente ao reorder_point no schema atual.
	rows, err := s.db.Query(ctx, `
		SELECT organization_id, id, name, sku, total_stock, min_stock, stock_alert::text
		FROM products
		WHERE organization_id = $1
		  AND is_active = true
		  AND total_stock <= min_stock
		ORDER BY total_stock ASC
		LIMIT 100
	`, orgID)
	if err != nil {
		log.Printf("[StockAlerts] Erro ao buscar alertas para org %s: %v", orgID, err)
		return
	}
	defer rows.Close()

	var alerts []alertRow
	for rows.Next() {
		var a alertRow
		if err := rows.Scan(&a.OrgID, &a.ProductID, &a.Name, &a.SKU,
			&a.TotalStock, &a.MinStock, &a.StockAlert); err == nil {
			alerts = append(alerts, a)
		}
	}

	if len(alerts) == 0 {
		return
	}

	log.Printf("[StockAlerts] Org %s: %d produto(s) em alerta de estoque", orgID, len(alerts))

	for _, a := range alerts {
		log.Printf("[StockAlerts]  - %s (SKU: %s) estoque=%d mínimo=%d nível=%s",
			a.Name, a.SKU, a.TotalStock, a.MinStock, a.StockAlert)

		// TODO: enviar notificação por e-mail / webhook quando integração de notificação estiver pronta.
		// Por enquanto, registra na tabela de notifications para aparecer no painel.
		severity := mapAlertSeverity(a.StockAlert)
		msg := formatAlertMessage(a)

		_, err := s.db.Exec(ctx, `
			INSERT INTO notifications (organization_id, type, title, message, severity, created_at)
			VALUES ($1, 'stock_alert', 'Alerta de Estoque Baixo', $2, $3, NOW())
		`, a.OrgID, msg, severity)
		if err != nil {
			log.Printf("[StockAlerts] Erro ao salvar notificação para produto %s: %v", a.SKU, err)
		}
	}
}

func mapAlertSeverity(level string) string {
	switch level {
	case "out_of_stock":
		return "high"
	case "critical":
		return "high"
	case "low":
		return "medium"
	default:
		return "low"
	}
}

func formatAlertMessage(a alertRow) string {
	switch a.StockAlert {
	case "out_of_stock":
		return a.Name + " (SKU: " + a.SKU + ") está sem estoque."
	case "critical":
		return a.Name + " (SKU: " + a.SKU + ") tem estoque crítico: " +
			itoa(a.TotalStock) + " unidade(s). Mínimo: " + itoa(a.MinStock) + "."
	default:
		return a.Name + " (SKU: " + a.SKU + ") está abaixo do estoque mínimo: " +
			itoa(a.TotalStock) + "/" + itoa(a.MinStock) + " unidades."
	}
}

// itoa converte int para string sem importar strconv.
func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	neg := false
	if n < 0 {
		neg = true
		n = -n
	}
	buf := [20]byte{}
	pos := len(buf)
	for n > 0 {
		pos--
		buf[pos] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		pos--
		buf[pos] = '-'
	}
	return string(buf[pos:])
}
