package drivers

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

type OlistHubClient struct {
	ClientID     string
	ClientSecret string
	BaseURL      string
	HTTPClient   *http.Client
}

func NewOlistHubClient(clientID, clientSecret string) *OlistHubClient {
	return &OlistHubClient{
		ClientID:     clientID,
		ClientSecret: clientSecret,
		BaseURL:      "https://api.olist.com/v1", // Exemplo, deve alinhar com a URL real
		HTTPClient:   &http.Client{Timeout: 15 * time.Second},
	}
}

// PushOrder envia um novo pedido ao Olist Hub
func (c *OlistHubClient) PushOrder(ctx context.Context, orderData map[string]interface{}) (map[string]interface{}, error) {
	// 1. Em um cenário real, precisaríamos gerar o Access Token (OAuth)
	// token, err := c.getAccessToken(ctx)

	bodyBytes, err := json.Marshal(orderData)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal order data: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.BaseURL+"/orders", bytes.NewReader(bodyBytes))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	// req.Header.Set("Authorization", "Bearer "+token)

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to execute request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		respBody, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("olist hub api error: status=%d body=%s", resp.StatusCode, string(respBody))
	}

	var result map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return result, nil
}
