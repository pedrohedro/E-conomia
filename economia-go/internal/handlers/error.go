package handlers

import (
	"log"
	"net/http"
	"path/filepath"
)

// ErrorData holds the data for the error page template.
type ErrorData struct {
	PageTitle string
	Code      int
	Title     string
	Message   string
}

// ErrorPage renders the standardized error page with the given HTTP status code.
func (h *Handler) ErrorPage(w http.ResponseWriter, r *http.Request, code int, title, message string) {
	data := ErrorData{
		PageTitle: title,
		Code:      code,
		Title:     title,
		Message:   message,
	}

	w.WriteHeader(code)
	if err := h.pages["error"].ExecuteTemplate(w, "base", data); err != nil {
		log.Printf("Error rendering error page: %v", err)
		http.Error(w, message, code)
	}
}

// NotFound is a convenience handler for 404 errors.
func (h *Handler) NotFound(w http.ResponseWriter, r *http.Request) {
	h.ErrorPage(w, r, http.StatusNotFound,
		"Página não encontrada",
		"A página que você está tentando acessar não existe ou foi movida.")
}

// InternalServerError is a convenience handler for 500 errors.
func (h *Handler) InternalServerError(w http.ResponseWriter, r *http.Request) {
	h.ErrorPage(w, r, http.StatusInternalServerError,
		"Erro interno do servidor",
		"Ocorreu um erro inesperado. Tente novamente em alguns instantes.")
}

// componentFiles returns the list of component template files to parse alongside page templates.
func componentFiles() []string {
	components := []string{
		"kpi-card.html",
		"alert-banner.html",
		"loading.html",
		"error.html",
	}
	paths := make([]string, len(components))
	for i, c := range components {
		paths[i] = filepath.Join("templates", "components", c)
	}
	return paths
}
