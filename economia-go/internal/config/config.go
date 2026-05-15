package config

import "os"

type Config struct {
	Port              string
	DatabaseURL       string
	ClerkSecretKey    string
	ClerkPublishKey   string
	ClerkWebhookSecret string
	EncryptionKey     string
	MLClientID        string
	MLClientSecret    string
	OlistClientID     string
	OlistClientSecret string
	OmieAppKey        string
	OmieAppSecret     string
}

func Load() *Config {
	return &Config{
		Port:              getEnv("PORT", "8080"),
		DatabaseURL:       getEnv("DATABASE_URL", "postgres://localhost:5432/economia?sslmode=disable"),
		ClerkSecretKey:    getEnv("CLERK_SECRET_KEY", ""),
		ClerkPublishKey:   getEnv("CLERK_PUBLISHABLE_KEY", ""),
		ClerkWebhookSecret: getEnv("CLERK_WEBHOOK_SECRET", ""),
		EncryptionKey:     getEnv("ENCRYPTION_KEY", "economia-dev-key-fallback"),
		MLClientID:        getEnv("ML_CLIENT_ID", ""),
		MLClientSecret:    getEnv("ML_CLIENT_SECRET", ""),
		OlistClientID:     getEnv("OLIST_CLIENT_ID", ""),
		OlistClientSecret: getEnv("OLIST_CLIENT_SECRET", ""),
		OmieAppKey:        getEnv("OMIE_APP_KEY", ""),
		OmieAppSecret:     getEnv("OMIE_APP_SECRET", ""),
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
