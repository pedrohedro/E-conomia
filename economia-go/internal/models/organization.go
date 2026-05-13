package models

import "time"

type Organization struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Slug      string    `json:"slug"`
	CNPJ      *string   `json:"cnpj"`
	TaxRegime string    `json:"tax_regime"`
	TaxRate   float64   `json:"tax_rate"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type OrgMember struct {
	ID             string    `json:"id"`
	OrganizationID string    `json:"organization_id"`
	UserID         string    `json:"user_id"`
	Role           string    `json:"role"`
	IsActive       bool      `json:"is_active"`
	CreatedAt      time.Time `json:"created_at"`
}
