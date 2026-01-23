package plugin

import (
	"fmt"
	"sync"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
)

// ShareMetadata represents a shared session with its metadata
type ShareMetadata struct {
	ShareID    string     `json:"shareId"`
	SessionID  string     `json:"sessionId"`
	OrgID      int64      `json:"orgId"`
	UserID     int64      `json:"userId"`
	ExpiresAt  *time.Time `json:"expiresAt,omitempty"`
	CreatedAt  time.Time  `json:"createdAt"`
	SessionData []byte    `json:"sessionData"` // JSON snapshot of session
}

// ShareStoreInterface defines the interface for share storage implementations
type ShareStoreInterface interface {
	CreateShare(sessionID string, sessionData []byte, orgID, userID int64, expiresInHours *int) (*ShareMetadata, error)
	GetShare(shareID string) (*ShareMetadata, error)
	DeleteShare(shareID string) error
	GetSharesBySession(sessionID string) []*ShareMetadata
	CleanupExpired()
}

// ShareStore manages share metadata storage (in-memory implementation)
type ShareStore struct {
	mu          sync.RWMutex
	shares      map[string]*ShareMetadata // keyed by shareId
	rateLimiter RateLimiter
	logger      log.Logger
}

// NewShareStore creates a new share store
func NewShareStore(logger log.Logger, rateLimiter RateLimiter) *ShareStore {
	return &ShareStore{
		shares:      make(map[string]*ShareMetadata),
		rateLimiter: rateLimiter,
		logger:      logger,
	}
}

// CreateShare creates a new share and returns the share metadata
func (s *ShareStore) CreateShare(sessionID string, sessionData []byte, orgID, userID int64, expiresInHours *int) (*ShareMetadata, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Check rate limit
	if !s.rateLimiter.CheckLimit(userID) {
		return nil, fmt.Errorf("rate limit exceeded: too many share requests")
	}

	// Generate secure share ID
	shareID, err := generateShareID()
	if err != nil {
		return nil, fmt.Errorf("failed to generate share ID: %w", err)
	}

	// Calculate expiration
	expiresAt, _ := CalculateExpiration(expiresInHours)

	share := &ShareMetadata{
		ShareID:    shareID,
		SessionID:  sessionID,
		OrgID:      orgID,
		UserID:     userID,
		ExpiresAt:  expiresAt,
		CreatedAt:  time.Now(),
		SessionData: sessionData,
	}

	s.shares[shareID] = share
	s.logger.Info("Share created", "shareId", shareID, "sessionId", sessionID, "orgId", orgID, "userId", userID)

	return share, nil
}

// GetShare retrieves a share by ID
func (s *ShareStore) GetShare(shareID string) (*ShareMetadata, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	share, exists := s.shares[shareID]
	if !exists {
		return nil, fmt.Errorf("share not found")
	}

	// Check if expired
	if share.ExpiresAt != nil && share.ExpiresAt.Before(time.Now()) {
		return nil, fmt.Errorf("share expired")
	}

	return share, nil
}

// DeleteShare removes a share
func (s *ShareStore) DeleteShare(shareID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, exists := s.shares[shareID]; !exists {
		return fmt.Errorf("share not found")
	}

	delete(s.shares, shareID)
	s.logger.Info("Share deleted", "shareId", shareID)
	return nil
}

// GetSharesBySession returns all active shares for a session
func (s *ShareStore) GetSharesBySession(sessionID string) []*ShareMetadata {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var shares []*ShareMetadata
	now := time.Now()

	for _, share := range s.shares {
		if share.SessionID == sessionID {
			// Only include non-expired shares
			if share.ExpiresAt == nil || share.ExpiresAt.After(now) {
				shares = append(shares, share)
			}
		}
	}

	return shares
}

// CleanupExpired removes all expired shares
func (s *ShareStore) CleanupExpired() {
	s.mu.Lock()
	defer s.mu.Unlock()

	now := time.Now()
	count := 0

	for shareID, share := range s.shares {
		if share.ExpiresAt != nil && share.ExpiresAt.Before(now) {
			delete(s.shares, shareID)
			count++
		}
	}

	if count > 0 {
		s.logger.Info("Cleaned up expired shares", "count", count)
	}
}

