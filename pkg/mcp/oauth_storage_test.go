package mcp

import (
	"context"
	"crypto/rand"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	"github.com/redis/go-redis/v9"
)

func setupTestRedis(t *testing.T) (*redis.Client, *miniredis.Miniredis) {
	// Start miniredis server
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("Failed to start miniredis: %v", err)
	}

	// Create Redis client
	client := redis.NewClient(&redis.Options{
		Addr: mr.Addr(),
	})

	return client, mr
}

func TestTokenStoreEncryptDecrypt(t *testing.T) {
	// Generate encryption key
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		t.Fatalf("Failed to generate key: %v", err)
	}

	client, mr := setupTestRedis(t)
	defer mr.Close()
	defer client.Close()

	logger := log.NewNullLogger()
	store := NewTokenStore(client, key, logger)

	// Test data
	plaintext := "my-super-secret-access-token"

	// Encrypt
	encrypted, err := store.encrypt(plaintext)
	if err != nil {
		t.Fatalf("Encryption failed: %v", err)
	}

	if encrypted == plaintext {
		t.Error("Encrypted text should not equal plaintext")
	}

	// Decrypt
	decrypted, err := store.decrypt(encrypted)
	if err != nil {
		t.Fatalf("Decryption failed: %v", err)
	}

	if decrypted != plaintext {
		t.Errorf("Decrypted text does not match original: expected %s, got %s", plaintext, decrypted)
	}
}

func TestTokenStoreSaveLoad(t *testing.T) {
	// Generate encryption key
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		t.Fatalf("Failed to generate key: %v", err)
	}

	client, mr := setupTestRedis(t)
	defer mr.Close()
	defer client.Close()

	logger := log.NewNullLogger()
	store := NewTokenStore(client, key, logger)

	ctx := context.Background()

	// Create test token
	token := &StoredToken{
		ServerID:     "test-server",
		UserID:       123,
		AccessToken:  "access-token-12345",
		RefreshToken: "refresh-token-67890",
		TokenType:    "Bearer",
		ExpiresAt:    time.Now().Add(1 * time.Hour),
		Scopes:       []string{"mcp:tools", "mcp:resources"},
		Audience:     "https://mcp-server.example.com",
	}

	// Save token
	err := store.Save(ctx, token)
	if err != nil {
		t.Fatalf("Save failed: %v", err)
	}

	// Load token
	loaded, err := store.Load(ctx, token.UserID, token.ServerID)
	if err != nil {
		t.Fatalf("Load failed: %v", err)
	}

	// Verify all fields
	if loaded.ServerID != token.ServerID {
		t.Errorf("ServerID mismatch: expected %s, got %s", token.ServerID, loaded.ServerID)
	}
	if loaded.UserID != token.UserID {
		t.Errorf("UserID mismatch: expected %d, got %d", token.UserID, loaded.UserID)
	}
	if loaded.AccessToken != token.AccessToken {
		t.Errorf("AccessToken mismatch: expected %s, got %s", token.AccessToken, loaded.AccessToken)
	}
	if loaded.RefreshToken != token.RefreshToken {
		t.Errorf("RefreshToken mismatch: expected %s, got %s", token.RefreshToken, loaded.RefreshToken)
	}
	if loaded.TokenType != token.TokenType {
		t.Errorf("TokenType mismatch: expected %s, got %s", token.TokenType, loaded.TokenType)
	}
	if len(loaded.Scopes) != len(token.Scopes) {
		t.Errorf("Scopes length mismatch: expected %d, got %d", len(token.Scopes), len(loaded.Scopes))
	}
	if loaded.Audience != token.Audience {
		t.Errorf("Audience mismatch: expected %s, got %s", token.Audience, loaded.Audience)
	}
}

func TestTokenStoreDelete(t *testing.T) {
	// Generate encryption key
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		t.Fatalf("Failed to generate key: %v", err)
	}

	client, mr := setupTestRedis(t)
	defer mr.Close()
	defer client.Close()

	logger := log.NewNullLogger()
	store := NewTokenStore(client, key, logger)

	ctx := context.Background()

	// Create and save token
	token := &StoredToken{
		ServerID:     "test-server",
		UserID:       123,
		AccessToken:  "access-token",
		RefreshToken: "refresh-token",
		TokenType:    "Bearer",
		ExpiresAt:    time.Now().Add(1 * time.Hour),
		Scopes:       []string{"mcp:tools"},
		Audience:     "https://example.com",
	}

	err := store.Save(ctx, token)
	if err != nil {
		t.Fatalf("Save failed: %v", err)
	}

	// Delete token
	err = store.Delete(ctx, token.UserID, token.ServerID)
	if err != nil {
		t.Fatalf("Delete failed: %v", err)
	}

	// Verify token is deleted
	_, err = store.Load(ctx, token.UserID, token.ServerID)
	if err == nil {
		t.Error("Expected error when loading deleted token, got nil")
	}
}

func TestTokenStoreNotFound(t *testing.T) {
	// Generate encryption key
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		t.Fatalf("Failed to generate key: %v", err)
	}

	client, mr := setupTestRedis(t)
	defer mr.Close()
	defer client.Close()

	logger := log.NewNullLogger()
	store := NewTokenStore(client, key, logger)

	ctx := context.Background()

	// Try to load non-existent token
	_, err := store.Load(ctx, 999, "non-existent-server")
	if err == nil {
		t.Error("Expected error when loading non-existent token, got nil")
	}
}

func TestTokenStoreUserScoping(t *testing.T) {
	// Generate encryption key
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		t.Fatalf("Failed to generate key: %v", err)
	}

	client, mr := setupTestRedis(t)
	defer mr.Close()
	defer client.Close()

	logger := log.NewNullLogger()
	store := NewTokenStore(client, key, logger)

	ctx := context.Background()

	// Create tokens for different users
	token1 := &StoredToken{
		ServerID:     "test-server",
		UserID:       123,
		AccessToken:  "user-123-token",
		RefreshToken: "user-123-refresh",
		TokenType:    "Bearer",
		ExpiresAt:    time.Now().Add(1 * time.Hour),
		Scopes:       []string{"mcp:tools"},
		Audience:     "https://example.com",
	}

	token2 := &StoredToken{
		ServerID:     "test-server",
		UserID:       456,
		AccessToken:  "user-456-token",
		RefreshToken: "user-456-refresh",
		TokenType:    "Bearer",
		ExpiresAt:    time.Now().Add(1 * time.Hour),
		Scopes:       []string{"mcp:tools"},
		Audience:     "https://example.com",
	}

	// Save both tokens
	if err := store.Save(ctx, token1); err != nil {
		t.Fatalf("Failed to save token1: %v", err)
	}
	if err := store.Save(ctx, token2); err != nil {
		t.Fatalf("Failed to save token2: %v", err)
	}

	// Load user 123's token
	loaded1, err := store.Load(ctx, 123, "test-server")
	if err != nil {
		t.Fatalf("Failed to load user 123 token: %v", err)
	}
	if loaded1.AccessToken != "user-123-token" {
		t.Errorf("Got wrong token for user 123: %s", loaded1.AccessToken)
	}

	// Load user 456's token
	loaded2, err := store.Load(ctx, 456, "test-server")
	if err != nil {
		t.Fatalf("Failed to load user 456 token: %v", err)
	}
	if loaded2.AccessToken != "user-456-token" {
		t.Errorf("Got wrong token for user 456: %s", loaded2.AccessToken)
	}

	// Verify tokens are different
	if loaded1.AccessToken == loaded2.AccessToken {
		t.Error("Tokens for different users should be different")
	}
}
