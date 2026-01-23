package mcp

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	"github.com/redis/go-redis/v9"
)

// TokenStore manages encrypted OAuth tokens in Redis
// Uses the same Redis instance as shares, but with different key prefix
type TokenStore struct {
	client        *redis.Client
	encryptionKey []byte // 32 bytes for AES-256
	logger        log.Logger
	keyPrefix     string // "oauth:token:"
}

// StoredToken represents an OAuth token stored in Redis
type StoredToken struct {
	ServerID     string    `json:"serverId"`
	UserID       int64     `json:"userId"` // Grafana user ID (user-scoped tokens)
	AccessToken  string    `json:"accessToken"`   // Encrypted
	RefreshToken string    `json:"refreshToken"`  // Encrypted
	TokenType    string    `json:"tokenType"`
	ExpiresAt    time.Time `json:"expiresAt"`
	Scopes       []string  `json:"scopes"`
	Audience     string    `json:"audience"`
}

// NewTokenStore creates a new token store
// Reuses the existing Redis client from the plugin
func NewTokenStore(redisClient *redis.Client, encryptionKey []byte, logger log.Logger) *TokenStore {
	return &TokenStore{
		client:        redisClient,
		encryptionKey: encryptionKey,
		logger:        logger,
		keyPrefix:     "oauth:token:", // Different from share: prefix
	}
}

// Save stores an encrypted token in Redis with TTL
// Key format: oauth:token:{userID}:{serverID}
func (s *TokenStore) Save(ctx context.Context, token *StoredToken) error {
	// Encrypt sensitive fields
	encryptedAccess, err := s.encrypt(token.AccessToken)
	if err != nil {
		return fmt.Errorf("encrypt access token: %w", err)
	}

	encryptedRefresh := ""
	if token.RefreshToken != "" {
		encryptedRefresh, err = s.encrypt(token.RefreshToken)
		if err != nil {
			return fmt.Errorf("encrypt refresh token: %w", err)
		}
	}

	// Create copy with encrypted tokens
	encrypted := *token
	encrypted.AccessToken = encryptedAccess
	encrypted.RefreshToken = encryptedRefresh

	// Serialize to JSON
	data, err := json.Marshal(encrypted)
	if err != nil {
		return fmt.Errorf("marshal token: %w", err)
	}

	// User-scoped key: oauth:token:{userID}:{serverID}
	key := fmt.Sprintf("%s%d:%s", s.keyPrefix, token.UserID, token.ServerID)
	ttl := time.Until(token.ExpiresAt) + 24*time.Hour // Extra buffer for refresh

	// Save to Redis with TTL (pattern from shares_redis.go)
	if err := s.client.Set(ctx, key, data, ttl).Err(); err != nil {
		return fmt.Errorf("redis set: %w", err)
	}

	s.logger.Info("OAuth token saved", "server", token.ServerID, "userId", token.UserID, "expiresAt", token.ExpiresAt)
	return nil
}

// Load retrieves and decrypts a token from Redis
func (s *TokenStore) Load(ctx context.Context, userID int64, serverID string) (*StoredToken, error) {
	key := fmt.Sprintf("%s%d:%s", s.keyPrefix, userID, serverID)

	data, err := s.client.Get(ctx, key).Bytes()
	if err == redis.Nil {
		return nil, fmt.Errorf("token not found")
	}
	if err != nil {
		return nil, fmt.Errorf("redis get: %w", err)
	}

	var token StoredToken
	if err := json.Unmarshal(data, &token); err != nil {
		return nil, fmt.Errorf("unmarshal token: %w", err)
	}

	// Decrypt sensitive fields
	token.AccessToken, err = s.decrypt(token.AccessToken)
	if err != nil {
		return nil, fmt.Errorf("decrypt access token: %w", err)
	}

	if token.RefreshToken != "" {
		token.RefreshToken, err = s.decrypt(token.RefreshToken)
		if err != nil {
			return nil, fmt.Errorf("decrypt refresh token: %w", err)
		}
	}

	return &token, nil
}

// Delete removes a token from Redis
func (s *TokenStore) Delete(ctx context.Context, userID int64, serverID string) error {
	key := fmt.Sprintf("%s%d:%s", s.keyPrefix, userID, serverID)
	if err := s.client.Del(ctx, key).Err(); err != nil {
		return fmt.Errorf("redis del: %w", err)
	}

	s.logger.Info("OAuth token deleted", "server", serverID, "userId", userID)
	return nil
}

// encrypt uses AES-256-GCM to encrypt a plaintext string
func (s *TokenStore) encrypt(plaintext string) (string, error) {
	block, err := aes.NewCipher(s.encryptionKey)
	if err != nil {
		return "", err
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}

	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}

	ciphertext := gcm.Seal(nonce, nonce, []byte(plaintext), nil)
	return base64.StdEncoding.EncodeToString(ciphertext), nil
}

// decrypt uses AES-256-GCM to decrypt a ciphertext string
func (s *TokenStore) decrypt(encoded string) (string, error) {
	ciphertext, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return "", err
	}

	block, err := aes.NewCipher(s.encryptionKey)
	if err != nil {
		return "", err
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}

	nonceSize := gcm.NonceSize()
	if len(ciphertext) < nonceSize {
		return "", fmt.Errorf("ciphertext too short")
	}

	nonce, ciphertext := ciphertext[:nonceSize], ciphertext[nonceSize:]
	plaintext, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return "", err
	}

	return string(plaintext), nil
}
