package main

import (
	"context"
	"fmt"
	"html/template"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"

	"github.com/pedrohedro/economia-go/internal/config"
	"github.com/pedrohedro/economia-go/internal/db"
	"github.com/pedrohedro/economia-go/internal/handlers"
	"github.com/pedrohedro/economia-go/internal/handlers/partials"
	"github.com/pedrohedro/economia-go/internal/middleware"
)

func main() {
	cfg := config.Load()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	pool, err := db.NewPool(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	defer pool.Close()
	log.Println("✓ Database connected")

	r := chi.NewRouter()

	// Global middleware
	r.Use(chimw.RequestID)
	r.Use(chimw.RealIP)
	r.Use(middleware.Logger)
	r.Use(chimw.Recoverer)
	r.Use(chimw.Compress(5))

	// Static files
	fs := http.FileServer(http.Dir("static"))
	r.Handle("/static/*", http.StripPrefix("/static/", fs))

	// Health check
	r.Get("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
		w.Write([]byte("ok"))
	})

	r.Get("/", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/home", http.StatusSeeOther)
	})

	r.Get("/home", func(w http.ResponseWriter, r *http.Request) {
		http.ServeFile(w, r, "static/landing.html")
	})

	r.Get("/login", func(w http.ResponseWriter, r *http.Request) {
		clerkKey := cfg.ClerkPublishKey
		if clerkKey == "" {
			clerkKey = os.Getenv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY")
		}

		tmpl, err := template.ParseFiles("templates/pages/login.html")
		if err != nil {
			http.Error(w, "Error loading login template", 500)
			return
		}

		w.Header().Set("Content-Type", "text/html")
		tmpl.Execute(w, map[string]string{
			"ClerkKey": clerkKey,
		})
	})

	// Authenticated routes
	h := handlers.New(pool)
	p := partials.New(pool)

	r.Group(func(r chi.Router) {
		r.Use(middleware.RequireAuth)
		r.Use(middleware.RequireOrg)

		// Full page renders
		r.Get("/dashboard", h.Dashboard)
		r.Get("/estoque", h.Estoque)
		r.Get("/pedidos", h.PedidosPage)
		r.Get("/vendas", h.VendasPage)
		r.Get("/marketplaces", h.MarketplacesPage)
		r.Get("/contabil", h.ContabilPage)

		// HTMX partials
		r.Get("/partials/dashboard/kpis", p.DashboardKPIs)
		r.Get("/partials/stock-alerts", p.StockAlerts)
		r.Get("/partials/estoque/table", p.EstoqueTable)
		r.Get("/partials/pedidos-table", h.PedidosTable)
		r.Get("/partials/vendas-report", h.VendasReport)
	})

	// Webhooks (Public)
	wh := handlers.NewWebhookHandler(pool)
	clerkWh := handlers.NewClerkWebhookHandler(pool, cfg.ClerkWebhookSecret)
	
	r.Post("/webhooks/clerk", clerkWh.ServeHTTP)
	r.Post("/webhooks/olist", wh.OlistReceiver)
	r.Post("/webhooks/omie", wh.OmieReceiver)

	// Start server
	srv := &http.Server{
		Addr:         ":" + cfg.Port,
		Handler:      r,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	go func() {
		log.Printf("🚀 E-conomia server running on :%s", cfg.Port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server error: %v", err)
		}
	}()

	// Graceful shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	log.Println("Shutting down...")

	shutCtx, shutCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutCancel()
	if err := srv.Shutdown(shutCtx); err != nil {
		log.Fatalf("Shutdown error: %v", err)
	}
	fmt.Println("✓ Server stopped gracefully")
}
