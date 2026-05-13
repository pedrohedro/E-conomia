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

type OmieClient struct {
	AppKey    string
	AppSecret string
	BaseURL   string
	HTTPClient *http.Client
}

func NewOmieClient(appKey, appSecret string) *OmieClient {
	return &OmieClient{
		AppKey:    appKey,
		AppSecret: appSecret,
		BaseURL:   "https://app.omie.com.br/api/v1",
		HTTPClient: &http.Client{Timeout: 15 * time.Second},
	}
}

// Call executa uma chamada JSON-RPC para a API da Omie
func (c *OmieClient) Call(ctx context.Context, endpoint string, call string, param map[string]interface{}) (map[string]interface{}, error) {
	payload := map[string]interface{}{
		"call": call,
		"app_key": c.AppKey,
		"app_secret": c.AppSecret,
		"param": []map[string]interface{}{param},
	}

	bodyBytes, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal omie payload: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.BaseURL+endpoint, bytes.NewReader(bodyBytes))
	if err != nil {
		return nil, fmt.Errorf("failed to create omie request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to execute omie request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		respBody, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("omie api error: status=%d body=%s", resp.StatusCode, string(respBody))
	}

	var result map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to decode omie response: %w", err)
	}

	return result, nil
}
