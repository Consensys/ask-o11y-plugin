package plugin

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	"golang.org/x/time/rate"
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

// ShareStore manages share metadata storage
type ShareStore struct {
	mu        sync.RWMutex
	shares    map[string]*ShareMetadata // keyed by shareId
	rateLimit map[int64]*rateLimiter    // keyed by userID
	logger    log.Logger
}

type rateLimiter struct {
	limiter *rate.Limiter
	lastReset time.Time
}

// NewShareStore creates a new share store
func NewShareStore(logger log.Logger) *ShareStore {
	return &ShareStore{
		shares:    make(map[string]*ShareMetadata),
		rateLimit: make(map[int64]*rateLimiter),
		logger:    logger,
	}
}

// CreateShare creates a new share and returns the share metadata
func (s *ShareStore) CreateShare(sessionID string, sessionData []byte, orgID, userID int64, expiresInDays *int) (*ShareMetadata, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Check rate limit (10 shares per hour per user)
	if !s.checkRateLimit(userID) {
		return nil, fmt.Errorf("rate limit exceeded: too many share requests")
	}

	// Generate secure share ID
	shareID, err := generateShareID()
	if err != nil {
		return nil, fmt.Errorf("failed to generate share ID: %w", err)
	}

	// Calculate expiration
	var expiresAt *time.Time
	if expiresInDays != nil && *expiresInDays > 0 {
		exp := time.Now().Add(time.Duration(*expiresInDays) * 24 * time.Hour)
		expiresAt = &exp
	}

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

// checkRateLimit checks if user has exceeded rate limit (10 shares per hour)
func (s *ShareStore) checkRateLimit(userID int64) bool {
	rl, exists := s.rateLimit[userID]
	now := time.Now()

	// Reset if more than 1 hour has passed
	if exists && now.Sub(rl.lastReset) > time.Hour {
		rl.limiter = rate.NewLimiter(rate.Every(time.Hour/10), 10)
		rl.lastReset = now
	}

	// Create new limiter if doesn't exist
	if !exists {
		rl = &rateLimiter{
			limiter:   rate.NewLimiter(rate.Every(time.Hour/10), 10),
			lastReset: now,
		}
		s.rateLimit[userID] = rl
	}

	return rl.limiter.Allow()
}

// generateShareID generates a cryptographically secure share ID
func generateShareID() (string, error) {
	bytes := make([]byte, 32)
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
