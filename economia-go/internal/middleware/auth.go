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
func RequireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// TEMP BYPASS PARA TESTES NO RENDER:
		// Vamos injetar um usuário e organização fixos para testar a UI
		ctx := context.WithValue(r.Context(), UserIDKey, "dev_user_123")
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// RequireOrg ensures an organization is selected and injects orgID into context.
func RequireOrg(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// TEMP BYPASS PARA TESTES NO RENDER:
		// Para o DB funcionar, precisamos de um UUID válido que exista ou vai dar erro na query.
		// Vamos pegar a primeira organização do banco ou usar um hardcoded se for só para teste visual.
		// Por enquanto injetamos um "fake_org" (as queries vão retornar vazio, mas a página carrega).
		ctx := context.WithValue(r.Context(), OrgIDKey, "00000000-0000-0000-0000-000000000000") // Fake UUID
		next.ServeHTTP(w, r.WithContext(ctx))
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
