package plugin

import (
	"context"
	"testing"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	"github.com/redis/go-redis/v9"
)

// createTestRedisClient creates a Redis client for testing
// In real tests, this would use testcontainers or a mock
func createTestRedisClient(t *testing.T) *redis.Client {
	// For unit tests, we'll use a mock or skip if Redis is not available
	// In integration tests, we'd use testcontainers
	client := redis.NewClient(&redis.Options{
		Addr: "localhost:6379",
		DB:   15, // Use DB 15 for testing to avoid conflicts
	})

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	// Test connection
	if err := client.Ping(ctx).Err(); err != nil {
		t.Skipf("Redis not available for testing: %v", err)
	}

	// Clean up test database
	client.FlushDB(ctx)

	return client
}

func TestRedisShareStore_CreateShare(t *testing.T) {
	client := createTestRedisClient(t)
	defer client.Close()

	store := NewRedisShareStore(client, log.DefaultLogger)
	sessionData := []byte(`{"id":"session-123","messages":[{"role":"user","content":"test"}]}`)

	expiresInDays := 7
	share, err := store.CreateShare("session-123", sessionData, 1, 100, &expiresInDays)
	if err != nil {
		t.Fatalf("Failed to create share: %v", err)
	}

	if share.ShareID == "" {
		t.Error("ShareID should not be empty")
	}
	if share.SessionID != "session-123" {
		t.Errorf("Expected SessionID 'session-123', got '%s'", share.SessionID)
	}
	if share.OrgID != 1 {
		t.Errorf("Expected OrgID 1, got %d", share.OrgID)
	}
	if share.UserID != 100 {
		t.Errorf("Expected UserID 100, got %d", share.UserID)
	}
	if share.ExpiresAt == nil {
		t.Error("ExpiresAt should be set when expiresInDays is provided")
	}
	if share.SessionData == nil {
		t.Error("SessionData should not be nil")
	}
}

func TestRedisShareStore_GetShare(t *testing.T) {
	client := createTestRedisClient(t)
	defer client.Close()

	store := NewRedisShareStore(client, log.DefaultLogger)
	sessionData := []byte(`{"id":"session-123","messages":[{"role":"user","content":"test"}]}`)

	share, err := store.CreateShare("session-123", sessionData, 1, 100, nil)
	if err != nil {
		t.Fatalf("Failed to create share: %v", err)
	}

	retrieved, err := store.GetShare(share.ShareID)
	if err != nil {
		t.Fatalf("Failed to get share: %v", err)
	}

	if retrieved.ShareID != share.ShareID {
		t.Errorf("ShareID mismatch: expected '%s', got '%s'", share.ShareID, retrieved.ShareID)
	}
	if string(retrieved.SessionData) != string(sessionData) {
		t.Error("SessionData mismatch")
	}
}

func TestRedisShareStore_GetShare_NotFound(t *testing.T) {
	client := createTestRedisClient(t)
	defer client.Close()

	store := NewRedisShareStore(client, log.DefaultLogger)

	_, err := store.GetShare("non-existent")
	if err == nil {
		t.Error("Expected error for non-existent share")
	}
	if err.Error() != "share not found" {
		t.Errorf("Expected 'share not found', got '%s'", err.Error())
	}
}

func TestRedisShareStore_DeleteShare(t *testing.T) {
	client := createTestRedisClient(t)
	defer client.Close()

	store := NewRedisShareStore(client, log.DefaultLogger)
	sessionData := []byte(`{"id":"session-123","messages":[{"role":"user","content":"test"}]}`)

	share, err := store.CreateShare("session-123", sessionData, 1, 100, nil)
	if err != nil {
		t.Fatalf("Failed to create share: %v", err)
	}

	err = store.DeleteShare(share.ShareID)
	if err != nil {
		t.Fatalf("Failed to delete share: %v", err)
	}

	_, err = store.GetShare(share.ShareID)
	if err == nil {
		t.Error("Share should be deleted")
	}
}

func TestRedisShareStore_GetSharesBySession(t *testing.T) {
	client := createTestRedisClient(t)
	defer client.Close()

	store := NewRedisShareStore(client, log.DefaultLogger)
	sessionData := []byte(`{"id":"session-123","messages":[{"role":"user","content":"test"}]}`)

	// Create multiple shares for the same session
	share1, _ := store.CreateShare("session-123", sessionData, 1, 100, nil)
	share2, _ := store.CreateShare("session-123", sessionData, 1, 100, nil)
	store.CreateShare("session-456", sessionData, 1, 100, nil) // Different session

	shares := store.GetSharesBySession("session-123")
	if len(shares) != 2 {
		t.Errorf("Expected 2 shares, got %d", len(shares))
	}

	shareIDs := make(map[string]bool)
	for _, s := range shares {
		shareIDs[s.ShareID] = true
	}
	if !shareIDs[share1.ShareID] || !shareIDs[share2.ShareID] {
		t.Error("Expected shares not found")
	}
}

func TestRedisShareStore_RateLimit(t *testing.T) {
	client := createTestRedisClient(t)
	defer client.Close()

	store := NewRedisShareStore(client, log.DefaultLogger)
	sessionData := []byte(`{"id":"session-123","messages":[{"role":"user","content":"test"}]}`)

	// Create 10 shares (should succeed)
	for i := 0; i < 10; i++ {
		_, err := store.CreateShare("session-123", sessionData, 1, 100, nil)
		if err != nil {
			t.Fatalf("Failed to create share %d: %v", i, err)
		}
	}

	// 11th share should fail due to rate limit
	_, err := store.CreateShare("session-123", sessionData, 1, 100, nil)
	if err == nil {
		t.Error("Expected rate limit error")
	}
	if err.Error() != "rate limit exceeded: too many share requests" {
		t.Errorf("Expected rate limit error, got '%s'", err.Error())
	}
}

func TestRedisShareStore_RateLimit_ResetsAfterHour(t *testing.T) {
	client := createTestRedisClient(t)
	defer client.Close()

	store := NewRedisShareStore(client, log.DefaultLogger)
	sessionData := []byte(`{"id":"session-123","messages":[{"role":"user","content":"test"}]}`)

	// Create 10 shares
	for i := 0; i < 10; i++ {
		_, err := store.CreateShare("session-123", sessionData, 1, 100, nil)
		if err != nil {
			t.Fatalf("Failed to create share %d: %v", i, err)
		}
	}

	// 11th should fail
	_, err := store.CreateShare("session-123", sessionData, 1, 100, nil)
	if err == nil {
		t.Error("Expected rate limit error")
	}

	// Manually expire the rate limit key to simulate time passing
	ctx := context.Background()
	rateLimitKey := "ratelimit:100"
	client.Del(ctx, rateLimitKey)

	// Now should succeed again
	_, err = store.CreateShare("session-123", sessionData, 1, 100, nil)
	if err != nil {
		t.Errorf("Should succeed after rate limit reset, got: %v", err)
	}
}

func TestRedisShareStore_Expiration(t *testing.T) {
	client := createTestRedisClient(t)
	defer client.Close()

	store := NewRedisShareStore(client, log.DefaultLogger)
	sessionData := []byte(`{"id":"session-123","messages":[{"role":"user","content":"test"}]}`)

	// Create share with very short expiration (1 second)
	expiresInDays := -1 // This will create a share that expires in the past
	// Actually, let's create one with a future expiration and then manually expire it
	// Or better, create one with 1 day expiration and check TTL
	expiresInDays = 1
	share, err := store.CreateShare("session-123", sessionData, 1, 100, &expiresInDays)
	if err != nil {
		t.Fatalf("Failed to create share: %v", err)
	}

	// Share should exist
	_, err = store.GetShare(share.ShareID)
	if err != nil {
		t.Fatalf("Share should exist: %v", err)
	}

	// Check that TTL is set (should be approximately 1 day)
	ctx := context.Background()
	shareKey := "share:" + share.ShareID
	ttl := client.TTL(ctx, shareKey).Val()
	if ttl <= 0 {
		t.Error("Share should have a TTL set")
	}
	if ttl > 25*time.Hour || ttl < 23*time.Hour {
		t.Errorf("TTL should be approximately 1 day, got %v", ttl)
	}
}
