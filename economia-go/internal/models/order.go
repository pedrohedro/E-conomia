package models

import "time"

type Order struct {
	ID                  string    `json:"id"`
	OrganizationID      string    `json:"organization_id"`
	OrderNumber         string    `json:"order_number"`
	Marketplace         string    `json:"marketplace"`
	MarketplaceOrderID  *string   `json:"marketplace_order_id"`
	CustomerID          *string   `json:"customer_id"`
	Status              string    `json:"status"`
	Fulfillment         string    `json:"fulfillment"`
	GrossAmount         float64   `json:"gross_amount"`
	MarketplaceFeePct   float64   `json:"marketplace_fee_pct"`
	MarketplaceFeeAmt   float64   `json:"marketplace_fee_amt"`
	ShippingCost        float64   `json:"shipping_cost"`
	DiscountAmount      float64   `json:"discount_amount"`
	NetAmount           float64   `json:"net_amount"`
	NfeStatus           string    `json:"nfe_status"`
	TrackingCode        *string   `json:"tracking_code"`
	Carrier             *string   `json:"carrier"`
	MarketplaceCreatedAt *time.Time `json:"marketplace_created_at"`
	CreatedAt           time.Time  `json:"created_at"`
	UpdatedAt           time.Time  `json:"updated_at"`
}

type OrderItem struct {
	ID             string  `json:"id"`
	OrderID        string  `json:"order_id"`
	OrganizationID string  `json:"organization_id"`
	ProductID      *string `json:"product_id"`
	SKU            *string `json:"sku"`
	ProductName    string  `json:"product_name"`
	Quantity       int     `json:"quantity"`
	UnitPrice      float64 `json:"unit_price"`
	TotalPrice     float64 `json:"total_price"`
	CostPrice      float64 `json:"cost_price"`
}

type Customer struct {
	ID                string    `json:"id"`
	OrganizationID    string    `json:"organization_id"`
	Name              string    `json:"name"`
	Email             *string   `json:"email"`
	Phone             *string   `json:"phone"`
	Document          *string   `json:"document"`
	City              *string   `json:"city"`
	State             *string   `json:"state"`
	TotalOrders       int       `json:"total_orders"`
	TotalSpent        float64   `json:"total_spent"`
	CreatedAt         time.Time `json:"created_at"`
}
