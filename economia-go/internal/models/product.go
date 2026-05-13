package models

import "time"

type Product struct {
	ID             string    `json:"id"`
	OrganizationID string    `json:"organization_id"`
	SKU            string    `json:"sku"`
	Name           string    `json:"name"`
	Description    *string   `json:"description"`
	SupplierID     *string   `json:"supplier_id"`
	CostPrice      float64   `json:"cost_price"`
	SalePrice      float64   `json:"sale_price"`
	MarginPercent  float64   `json:"margin_percent"`
	TotalStock     int       `json:"total_stock"`
	MinStock       int       `json:"min_stock"`
	StockAlert     string    `json:"stock_alert"`
	WeightGrams    *int      `json:"weight_grams"`
	Barcode        *string   `json:"barcode"`
	NCM            *string   `json:"ncm"`
	ImageURL       *string   `json:"image_url"`
	Category       *string   `json:"category"`
	IsActive       bool      `json:"is_active"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}

type ChannelStock struct {
	ID             string    `json:"id"`
	OrganizationID string    `json:"organization_id"`
	ProductID      string    `json:"product_id"`
	Channel        string    `json:"channel"`
	Quantity       int       `json:"quantity"`
	Reserved       int       `json:"reserved"`
	Available      int       `json:"available"`
	ChannelSKU     *string   `json:"channel_sku"`
	UpdatedAt      time.Time `json:"updated_at"`
}
