# GEMINI.md - E-conomia CRM

## Project Overview
E-conomia CRM is a multi-marketplace CRM and ERP platform designed for e-commerce sellers, with a primary focus on Mercado Livre. It enables centralized management of products, inventory, sales, and financial data across multiple channels.

### Architecture Status
The project is currently in the middle of an architectural migration:
*   **Legacy/Current:** Static HTML + Vanilla JS frontend (Vercel) communicating with Supabase (PostgreSQL, Auth, Edge Functions) and a Node.js background worker (`graphile-worker` on Render).
*   **Target/New:** A Go monolith (Chi router) using HTMX for dynamic UI, Clerk for authentication, and a pure PostgreSQL database on Render.

## Directory Structure
*   `public/`: (Legacy) Static frontend files (HTML, JS, CSS) served via Vercel.
*   `supabase/`: (Legacy) Database migrations, Edge Functions (Deno), and configuration.
*   `economia-go/`: (New) Go backend implementation, including handlers, models, and templates.
*   `render-worker/`: (Legacy) Node.js background worker for processing queues.
*   `docs/`: Comprehensive project documentation (ARCHITECTURE, PRD, Migration Plans).
*   `tests/`: Manual and automated test scripts (Python/Playwright).
*   `scripts/`: Utility scripts for debugging.

## Core Technologies
*   **Backend:** Go (New) / Supabase Edge Functions (Legacy)
*   **Frontend:** HTMX + Go Templates (New) / HTML + Vanilla JS (Legacy)
*   **Database:** PostgreSQL (Render/Supabase)
*   **Auth:** Clerk (New) / Supabase Auth (Legacy)
*   **Integrations:** Mercado Livre, Amazon (SP-API), Shopee, Nuvemshop.

## Development & Operations

### Building and Running (Legacy)
*   **Local Frontend:** `npm run dev` (serves `public/` on port 3000)
*   **Supabase Local:** `supabase start`
*   **Deploy Edge Functions:** `npm run deploy:functions`
*   **Apply Migrations:** `npm run supabase:migrate`

### Building and Running (Go Backend)
*   **Directory:** Navigate to `economia-go/`
*   **Generate Templates:** `templ generate` (if using `templ`)
*   **Run Server:** `go run cmd/server/main.go`
*   **Build:** `go build -o bin/server ./cmd/server`

### Deployment
*   **Frontend:** Automatically deployed to Vercel on push to `main`.
*   **Go Backend:** Deployed to Render via `render.yaml`.
*   **Database:** Managed on Render (PostgreSQL).

## Development Conventions
*   **Migrations:** SQL migrations are versioned (e.g., `00001_*.sql`). Do not reorder existing migrations.
*   **Multi-tenancy:**
    *   Legacy: Handled via PostgreSQL Row Level Security (RLS) policies.
    *   New: Handled via Go middleware injecting `orgID` into the request context.
*   **Security:** Never commit `.env` files. Marketplace tokens are encrypted.
*   **Clean Code:** Follow the patterns defined in `@[skills/clean-code]`. Prioritize server-side rendering with HTMX for new features.

## Key Documentation
*   `docs/ARCHITECTURE.md`: Deep dive into the backend architecture.
*   `docs/PRD.md`: Product Requirements Document.
*   `migration-to-golang-implementation_plan.md`: Detailed plan for the Go transition.
*   `docs/PLAN-estoque-ml.md`: Specific plan for Mercado Livre inventory synchronization.
