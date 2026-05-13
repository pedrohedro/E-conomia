package handlers

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"
)

type WebhookHandler struct {
	DB *pgxpool.Pool
}

func NewWebhookHandler(db *pgxpool.Pool) *WebhookHandler {
	return &WebhookHandler{DB: db}
}

// OlistReceiver recebe notificações do Olist Hub
func (h *WebhookHandler) OlistReceiver(w http.ResponseWriter, r *http.Request) {
	var payload map[string]interface{}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, "Bad Request", http.StatusBadRequest)
		return
	}

	// 1. Identificar a organização (normalmente via token no header ou parâmetro de query customizado)
	// Como isso é público, teríamos um secret token por organização configurado.
	log.Printf("Received Olist Webhook: %+v", payload)

	// Aqui inseriríamos a lógica de interpretar a notificação:
	// - Pedido novo -> Inserir na tabela 'orders'
	// - Atualização de status -> Update 'orders'

	w.WriteHeader(http.StatusOK)
	fmt.Fprintf(w, "OK")
}

// OmieReceiver recebe notificações do ERP Omie
func (h *WebhookHandler) OmieReceiver(w http.ResponseWriter, r *http.Request) {
	var payload map[string]interface{}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, "Bad Request", http.StatusBadRequest)
		return
	}

	log.Printf("Received Omie Webhook: %+v", payload)

	w.WriteHeader(http.StatusOK)
	fmt.Fprintf(w, "OK")
}
