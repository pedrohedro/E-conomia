package middleware

import (
	"context"
	"log"
	"net/http"
	"strings"

	"github.com/clerk/clerk-sdk-go/v2"
	clerkhttp "github.com/clerk/clerk-sdk-go/v2/http"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type contextKey string

const (
	UserIDKey contextKey = "userID"
	OrgIDKey  contextKey = "orgID"
)

// RequireAuth validates the session cookie (Clerk) and injects the internal userID into context.
func RequireAuth(db *pgxpool.Pool) func(http.Handler) http.Handler {
	// First apply Clerk's native middleware which parses Bearer token or __session cookie
	clerkMiddleware := clerkhttp.RequireHeaderAuthorization()

	return func(next http.Handler) http.Handler {
		// Our custom handler wrapped inside Clerk's middleware
		handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			claims, ok := clerk.SessionClaimsFromContext(r.Context())
			if !ok {
				http.Redirect(w, r, "/login", http.StatusTemporaryRedirect)
				return
			}

			clerkID := claims.Subject
			if clerkID == "" {
				http.Redirect(w, r, "/login", http.StatusTemporaryRedirect)
				return
			}

			// Find internal user ID in Postgres
			var userID string
			err := db.QueryRow(r.Context(), "SELECT id FROM users WHERE clerk_id = $1", clerkID).Scan(&userID)
			if err != nil {
				if err == pgx.ErrNoRows {
					// User not synced yet via webhook
					log.Printf("Auth: User %s found in Clerk but not in DB yet", clerkID)
					http.Redirect(w, r, "/login?error=syncing", http.StatusTemporaryRedirect)
					return
				}
				log.Printf("Database error fetching user: %v", err)
				http.Error(w, "Internal Server Error", http.StatusInternalServerError)
				return
			}

			ctx := context.WithValue(r.Context(), UserIDKey, userID)
			next.ServeHTTP(w, r.WithContext(ctx))
		})

		return clerkMiddleware(handler)
	}
}

// RequireOrg ensures an organization is selected and injects orgID into context.
func RequireOrg(db *pgxpool.Pool) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			userID := GetUserID(r.Context())
			if userID == "" {
				http.Redirect(w, r, "/login", http.StatusTemporaryRedirect)
				return
			}

			// In a real app, this might come from a session cookie or header
			// For now, we just auto-select their first organization
			var orgID string
			err := db.QueryRow(r.Context(), `
				SELECT organization_id 
				FROM organization_members 
				WHERE user_id = $1 
				ORDER BY created_at ASC LIMIT 1
			`, userID).Scan(&orgID)

			if err != nil {
				if err == pgx.ErrNoRows {
					// User has no organizations
					log.Printf("Auth: User %s has no organizations", userID)
					// Let them pass without org for now, or we could return 403
					// ctx := context.WithValue(r.Context(), OrgIDKey, "")
					// next.ServeHTTP(w, r.WithContext(ctx))
					// return
					
					// Instead, block for safety since queries depend on orgID
					http.Error(w, "User has no organization. Please contact support.", http.StatusForbidden)
					return
				}
				log.Printf("Database error fetching org: %v", err)
				http.Error(w, "Internal Server Error", http.StatusInternalServerError)
				return
			}

			ctx := context.WithValue(r.Context(), OrgIDKey, orgID)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// GetUserID extracts the user ID from context.
func GetUserID(ctx context.Context) string {
	if v, ok := ctx.Value(UserIDKey).(string); ok {
		return v
	}
	return ""
}

// GetOrgID extracts the organization ID from context.
func GetOrgID(ctx context.Context) string {
	if v, ok := ctx.Value(OrgIDKey).(string); ok {
		return v
	}
	return ""
}

// IsHTMX checks if the request was made by HTMX
func IsHTMX(r *http.Request) bool {
	return strings.ToLower(r.Header.Get("HX-Request")) == "true"
}
