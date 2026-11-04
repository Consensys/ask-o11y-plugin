package plugin

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"time"
)

func isValidSecureID(id string) bool {
	expectedLen := base64.RawURLEncoding.EncodedLen(ShareIDBytes)
	if len(id) != expectedLen {
		return false
	}
	_, err := base64.RawURLEncoding.DecodeString(id)
	return err == nil
}

func generateShareID() (string, error) {
	bytes := make([]byte, ShareIDBytes)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}

	// Base64 URL-safe encoding without padding
	return base64.RawURLEncoding.EncodeToString(bytes), nil
}

// ValidateSessionData validates that session data has required fields
func ValidateSessionData(sessionData []byte) error {
	var data map[string]interface{}
	if err := json.Unmarshal(sessionData, &data); err != nil {
		return fmt.Errorf("invalid session data format: %w", err)
	}

	// Check required fields
	if _, ok := data["id"]; !ok {
		return fmt.Errorf("session data missing required field: id")
	}
	if _, ok := data["messages"]; !ok {
		return fmt.Errorf("session data missing required field: messages")
	}
	if messages, ok := data["messages"].([]interface{}); !ok {
		return fmt.Errorf("session data messages must be an array")
	} else if len(messages) == 0 {
		return fmt.Errorf("session data messages array cannot be empty")
	}

	return nil
}

// CalculateExpiration calculates the expiration time and TTL for a share.
// Every share has an expiry: an explicit one when expiresInHours is set,
// otherwise DefaultShareMaxTTL. The returned time is never nil, so the
// in-memory and Redis stores apply the same rule.
func CalculateExpiration(expiresInHours *int) (*time.Time, time.Duration) {
	var expiresAt *time.Time
	var ttl time.Duration

	if expiresInHours != nil && *expiresInHours > 0 {
		exp := time.Now().Add(time.Duration(*expiresInHours) * time.Hour)
		expiresAt = &exp
		ttl = time.Until(exp)
	} else {
		exp := time.Now().Add(DefaultShareMaxTTL)
		expiresAt = &exp
		ttl = DefaultShareMaxTTL
	}

	return expiresAt, ttl
}
