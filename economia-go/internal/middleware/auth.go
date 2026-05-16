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
	extractor := clerkhttp.AuthorizationJWTExtractor(func(r *http.Request) string {
		authHeader := r.Header.Get("Authorization")
		if strings.HasPrefix(authHeader, "Bearer ") {
			return strings.TrimPrefix(authHeader, "Bearer ")
		}
		cookie, err := r.Cookie("__session")
		if err == nil && cookie != nil {
			return cookie.Value
		}
		return ""
	})
	clerkMiddleware := clerkhttp.WithHeaderAuthorization(extractor)

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
			err := db.QueryRow(r.Context(), "SELECT id FROM profiles WHERE id = $1", clerkID).Scan(&userID)
			if err != nil {
				if err == pgx.ErrNoRows {
					// User not in DB yet (webhook delayed/missed) -> JIT Self-Healing Sync!
					log.Printf("Auth Self-Healing: Auto-creating profile for Clerk user %s", clerkID)
					_, errInsert := db.Exec(r.Context(), `
						INSERT INTO profiles (id, full_name, updated_at)
						VALUES ($1, $2, NOW())
						ON CONFLICT (id) DO NOTHING
					`, clerkID, "Usuário "+clerkID[:6])
					if errInsert != nil {
						log.Printf("Error during JIT profile insert: %v", errInsert)
					}
					userID = clerkID
				} else {
					log.Printf("Database error fetching user: %v", err)
					http.Error(w, "Internal Server Error", http.StatusInternalServerError)
					return
				}
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
				FROM org_members 
				WHERE user_id = $1 
				ORDER BY created_at ASC LIMIT 1
			`, userID).Scan(&orgID)

			if err != nil {
				if err == pgx.ErrNoRows {
					// User has no organizations (webhook missed or first login) -> JIT Self-Healing Sync!
					log.Printf("Auth Self-Healing: Auto-creating default organization for user %s", userID)
					errOrg := db.QueryRow(r.Context(), `
						INSERT INTO organizations (name, created_at, updated_at)
						VALUES ('Meu Negócio', NOW(), NOW())
						RETURNING id
					`).Scan(&orgID)
					if errOrg == nil {
						_, _ = db.Exec(r.Context(), `
							INSERT INTO org_members (organization_id, user_id, role)
							VALUES ($1, $2, 'admin')
						`, orgID, userID)
						log.Printf("Successfully created default organization %s for %s", orgID, userID)
					} else {
						log.Printf("Error creating default org: %v", errOrg)
						http.Error(w, "Error creating organization. Please contact support.", http.StatusInternalServerError)
						return
					}
				} else {
					log.Printf("Database error fetching org: %v", err)
					http.Error(w, "Internal Server Error", http.StatusInternalServerError)
					return
				}
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
