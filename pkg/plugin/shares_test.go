package plugin

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
)

func TestShareStore_CreateShare(t *testing.T) {
	store := NewShareStore(log.DefaultLogger)
	sessionData := []byte(`{"id":"session-123","messages":[{"role":"user","content":"test"}]}`)

	expiresInHours := 7 * 24 // 7 days in hours
	share, err := store.CreateShare("session-123", sessionData, 1, 100, &expiresInHours)
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
		t.Error("ExpiresAt should be set when expiresInHours is provided")
	}
	if share.SessionData == nil {
		t.Error("SessionData should not be nil")
	}
}

func TestShareStore_CreateShare_NoExpiry(t *testing.T) {
	store := NewShareStore(log.DefaultLogger)
	sessionData := []byte(`{"id":"session-123","messages":[{"role":"user","content":"test"}]}`)

	share, err := store.CreateShare("session-123", sessionData, 1, 100, nil)
	if err != nil {
		t.Fatalf("Failed to create share: %v", err)
	}

	if share.ExpiresAt != nil {
		t.Error("ExpiresAt should be nil when no expiry is provided")
	}
}

func TestShareStore_GetShare(t *testing.T) {
	store := NewShareStore(log.DefaultLogger)
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
}

func TestShareStore_GetShare_NotFound(t *testing.T) {
	store := NewShareStore(log.DefaultLogger)

	_, err := store.GetShare("non-existent")
	if err == nil {
		t.Error("Expected error for non-existent share")
	}
	if err.Error() != "share not found" {
		t.Errorf("Expected 'share not found', got '%s'", err.Error())
	}
}

func TestShareStore_GetShare_Expired(t *testing.T) {
	store := NewShareStore(log.DefaultLogger)
	sessionData := []byte(`{"id":"session-123","messages":[{"role":"user","content":"test"}]}`)

	expiresInHours := -1 // Expired (negative value)
	share, err := store.CreateShare("session-123", sessionData, 1, 100, &expiresInHours)
	if err != nil {
		t.Fatalf("Failed to create share: %v", err)
	}

	// Manually set expiry to past
	expiredTime := time.Now().Add(-1 * time.Hour)
	share.ExpiresAt = &expiredTime
	store.shares[share.ShareID] = share

	_, err = store.GetShare(share.ShareID)
	if err == nil {
		t.Error("Expected error for expired share")
	}
	if err.Error() != "share expired" {
		t.Errorf("Expected 'share expired', got '%s'", err.Error())
	}
}

func TestShareStore_DeleteShare(t *testing.T) {
	store := NewShareStore(log.DefaultLogger)
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

func TestShareStore_GetSharesBySession(t *testing.T) {
	store := NewShareStore(log.DefaultLogger)
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

func TestShareStore_CleanupExpired(t *testing.T) {
	store := NewShareStore(log.DefaultLogger)
	sessionData := []byte(`{"id":"session-123","messages":[{"role":"user","content":"test"}]}`)

	// Create expired share
	expiresInHours := -1 // Negative value (expired)
	expiredShare, _ := store.CreateShare("session-123", sessionData, 1, 100, &expiresInHours)
	expiredTime := time.Now().Add(-1 * time.Hour)
	expiredShare.ExpiresAt = &expiredTime
	store.shares[expiredShare.ShareID] = expiredShare

	// Create non-expired share
	store.CreateShare("session-456", sessionData, 1, 100, nil)

	store.CleanupExpired()

	// Expired share should be removed
	_, err := store.GetShare(expiredShare.ShareID)
	if err == nil {
		t.Error("Expired share should be cleaned up")
	}

	// Non-expired share should still exist
	shares := store.GetSharesBySession("session-456")
	if len(shares) != 1 {
		t.Error("Non-expired share should still exist")
	}
}

func TestShareStore_RateLimit(t *testing.T) {
	store := NewShareStore(log.DefaultLogger)
	sessionData := []byte(`{"id":"session-123","messages":[{"role":"user","content":"test"}]}`)

	// Create 50 shares (should succeed)
	for i := 0; i < 50; i++ {
		_, err := store.CreateShare("session-123", sessionData, 1, 100, nil)
		if err != nil {
			t.Fatalf("Failed to create share %d: %v", i, err)
		}
	}

	// 51st share should fail due to rate limit
	_, err := store.CreateShare("session-123", sessionData, 1, 100, nil)
	if err == nil {
		t.Error("Expected rate limit error")
	}
	if err.Error() != "rate limit exceeded: too many share requests" {
		t.Errorf("Expected rate limit error, got '%s'", err.Error())
	}
}

func TestValidateSessionData(t *testing.T) {
	validData := map[string]interface{}{
		"id":       "session-123",
		"messages": []interface{}{map[string]interface{}{"role": "user", "content": "test"}},
	}
	validJSON, _ := json.Marshal(validData)

	err := ValidateSessionData(validJSON)
	if err != nil {
		t.Errorf("Valid session data should pass validation: %v", err)
	}
}

func TestValidateSessionData_MissingID(t *testing.T) {
	invalidData := map[string]interface{}{
		"messages": []interface{}{map[string]interface{}{"role": "user", "content": "test"}},
	}
	invalidJSON, _ := json.Marshal(invalidData)

	err := ValidateSessionData(invalidJSON)
	if err == nil {
		t.Error("Expected error for missing id field")
	}
}

func TestValidateSessionData_MissingMessages(t *testing.T) {
	invalidData := map[string]interface{}{
		"id": "session-123",
	}
	invalidJSON, _ := json.Marshal(invalidData)

	err := ValidateSessionData(invalidJSON)
	if err == nil {
		t.Error("Expected error for missing messages field")
	}
}

func TestValidateSessionData_EmptyMessages(t *testing.T) {
	invalidData := map[string]interface{}{
		"id":       "session-123",
		"messages": []interface{}{},
	}
	invalidJSON, _ := json.Marshal(invalidData)

	err := ValidateSessionData(invalidJSON)
	if err == nil {
		t.Error("Expected error for empty messages array")
	}
}

func TestGenerateShareID(t *testing.T) {
	shareID1, err := generateShareID()
	if err != nil {
		t.Fatalf("Failed to generate share ID: %v", err)
	}
	if shareID1 == "" {
		t.Error("Share ID should not be empty")
	}

	shareID2, _ := generateShareID()
	if shareID1 == shareID2 {
		t.Error("Share IDs should be unique")
	}

	// Check it's base64 URL-safe (no padding)
	if len(shareID1) < 32 {
		t.Error("Share ID should be at least 32 characters (base64 of 32 bytes)")
	}
}
