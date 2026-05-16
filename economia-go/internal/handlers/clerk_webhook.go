package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	svix "github.com/svix/svix-webhooks/go"
)

type ClerkWebhookHandler struct {
	db     *pgxpool.Pool
	secret string
}

func NewClerkWebhookHandler(db *pgxpool.Pool, secret string) *ClerkWebhookHandler {
	return &ClerkWebhookHandler{
		db:     db,
		secret: secret,
	}
}

type ClerkEvent struct {
	Data struct {
		ID           string `json:"id"`
		EmailAddresses []struct {
			EmailAddress string `json:"email_address"`
		} `json:"email_addresses"`
		FirstName string `json:"first_name"`
		LastName  string `json:"last_name"`
	} `json:"data"`
	Type string `json:"type"`
}

func (h *ClerkWebhookHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if h.secret == "" {
		log.Println("Clerk webhook secret not configured")
		http.Error(w, "Webhook secret not configured", http.StatusInternalServerError)
		return
	}

	payload, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "Could not read body", http.StatusBadRequest)
		return
	}

	wh, err := svix.NewWebhook(h.secret)
	if err != nil {
		log.Printf("Error creating Svix webhook: %v", err)
		http.Error(w, "Invalid webhook secret format", http.StatusInternalServerError)
		return
	}

	err = wh.Verify(payload, r.Header)
	if err != nil {
		log.Printf("Invalid svix signature: %v", err)
		http.Error(w, "Invalid signature", http.StatusUnauthorized)
		return
	}

	var event ClerkEvent
	if err := json.Unmarshal(payload, &event); err != nil {
		log.Printf("Error parsing clerk event: %v", err)
		http.Error(w, "Error parsing payload", http.StatusBadRequest)
		return
	}

	switch event.Type {
	case "user.created", "user.updated":
		h.handleUserSync(r.Context(), event)
	default:
		// Ignore other events
	}

	w.WriteHeader(http.StatusOK)
}

func (h *ClerkWebhookHandler) handleUserSync(ctx context.Context, event ClerkEvent) {
	email := ""
	if len(event.Data.EmailAddresses) > 0 {
		email = event.Data.EmailAddresses[0].EmailAddress
	}

	// Combine first and last name
	fullName := event.Data.FirstName
	if event.Data.LastName != "" {
		if fullName != "" {
			fullName += " "
		}
		fullName += event.Data.LastName
	}

	// Upsert user into database (profiles table)
	query := `
		INSERT INTO profiles (id, full_name, updated_at)
		VALUES ($1, $2, NOW())
		ON CONFLICT (id) DO UPDATE SET
			full_name = EXCLUDED.full_name,
			updated_at = NOW();
	`
	_, err := h.db.Exec(ctx, query, event.Data.ID, fullName)
	if err != nil {
		log.Printf("Error upserting profile %s: %v", event.Data.ID, err)
		return
	}

	log.Printf("Successfully synced profile %s (%s)", event.Data.ID, email)

	// Ensure user has at least one organization
	h.ensureUserOrganization(ctx, event.Data.ID, event.Data.FirstName)
}

func (h *ClerkWebhookHandler) ensureUserOrganization(ctx context.Context, clerkID string, firstName string) {
	// For profiles, clerkID is the internal ID directly!
	userID := clerkID

	// Check if user is already in any organization
	var orgCount int
	err := h.db.QueryRow(ctx, "SELECT COUNT(*) FROM org_members WHERE user_id = $1", userID).Scan(&orgCount)
	if err != nil {
		log.Printf("Error checking user organizations: %v", err)
		return
	}

	if orgCount == 0 {
		// Create a default organization
		orgName := "Meu Negócio"
		if firstName != "" {
			orgName = "Negócio de " + firstName
		}

		slug := fmt.Sprintf("org-%s-%d", userID[:8], time.Now().Unix())
		var orgID string
		err = h.db.QueryRow(ctx, `
			INSERT INTO organizations (name, slug, created_at, updated_at)
			VALUES ($1, $2, NOW(), NOW())
			RETURNING id
		`, orgName, slug).Scan(&orgID)
		if err != nil {
			log.Printf("Error creating default organization: %v", err)
			return
		}

		// Add user to the new organization as admin (user_role enum in DB)
		_, err = h.db.Exec(ctx, `
			INSERT INTO org_members (organization_id, user_id, role)
			VALUES ($1, $2, 'admin')
		`, orgID, userID)
		if err != nil {
			log.Printf("Error adding user to organization: %v", err)
		} else {
			log.Printf("Created default organization '%s' for user %s", orgName, userID)
		}
	}
}
