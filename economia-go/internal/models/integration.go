package models

import "time"

type Integration struct {
	ID              string    `json:"id"`
	OrganizationID  string    `json:"organization_id"`
	Marketplace     string    `json:"marketplace"`
	Status          string    `json:"status"`
	SellerNickname  *string   `json:"seller_nickname"`
	SellerID        *string   `json:"seller_id"`
	LastSyncAt      *time.Time `json:"last_sync_at"`
	LastSyncError   *string   `json:"last_sync_error"`
	CreatedAt       time.Time  `json:"created_at"`
}
