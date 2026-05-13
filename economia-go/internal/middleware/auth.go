package middleware

import (
	"context"
	"net/http"
)

type contextKey string

const (
	UserIDKey contextKey = "userID"
	OrgIDKey  contextKey = "orgID"
)

// RequireAuth validates the session cookie (Clerk) and injects userID into context.
// For development, it accepts a header X-Dev-User-ID to bypass Clerk.
func RequireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// DEV MODE: bypass auth with header
		if devUser := r.Header.Get("X-Dev-User-ID"); devUser != "" {
			ctx := context.WithValue(r.Context(), UserIDKey, devUser)
			next.ServeHTTP(w, r.WithContext(ctx))
			return
		}

		// TODO: Integrate Clerk SDK when keys are configured
		// claims, err := clerk.VerifySession(r)
		// if err != nil { redirect to /login }
		// ctx := context.WithValue(r.Context(), UserIDKey, claims.Subject)

		// For now, redirect to login if no dev header
		http.Redirect(w, r, "/login", http.StatusSeeOther)
	})
}

// RequireOrg ensures an organization is selected and injects orgID into context.
func RequireOrg(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// DEV MODE: bypass with header
		if devOrg := r.Header.Get("X-Dev-Org-ID"); devOrg != "" {
			ctx := context.WithValue(r.Context(), OrgIDKey, devOrg)
			next.ServeHTTP(w, r.WithContext(ctx))
			return
		}

		// TODO: Get from Clerk session's ActiveOrganizationID
		// or from cookie/query param

		http.Redirect(w, r, "/onboarding", http.StatusSeeOther)
	})
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
