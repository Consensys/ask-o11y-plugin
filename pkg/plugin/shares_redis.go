package plugin

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	"github.com/redis/go-redis/v9"
)

// RedisShareStore manages share metadata storage using Redis
type RedisShareStore struct {
	client *redis.Client
	logger log.Logger
	ctx    context.Context
}

// NewRedisShareStore creates a new Redis-backed share store
func NewRedisShareStore(client *redis.Client, logger log.Logger) *RedisShareStore {
	return &RedisShareStore{
		client: client,
		logger: logger,
		ctx:    context.Background(),
	}
}

// CreateShare creates a new share and returns the share metadata
func (s *RedisShareStore) CreateShare(sessionID string, sessionData []byte, orgID, userID int64, expiresInHours *int) (*ShareMetadata, error) {
	// Check rate limit (50 shares per hour per user)
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
	var ttl time.Duration
	if expiresInHours != nil && *expiresInHours > 0 {
		exp := time.Now().Add(time.Duration(*expiresInHours) * time.Hour)
		expiresAt = &exp
		ttl = time.Until(exp)
	} else {
		// Default max TTL of 1 year for shares without explicit expiration
		ttl = 365 * 24 * time.Hour
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

	// Serialize share metadata
	shareJSON, err := json.Marshal(share)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal share: %w", err)
	}

	// Store share in Redis with TTL
	shareKey := fmt.Sprintf("share:%s", shareID)
	if err := s.client.Set(s.ctx, shareKey, shareJSON, ttl).Err(); err != nil {
		return nil, fmt.Errorf("failed to store share in Redis: %w", err)
	}

	// Add share ID to session index set (no expiration on the set itself)
	sessionIndexKey := fmt.Sprintf("session:%s:shares", sessionID)
	if err := s.client.SAdd(s.ctx, sessionIndexKey, shareID).Err(); err != nil {
		// Log error but don't fail - the share is already stored
		s.logger.Warn("Failed to add share to session index", "error", err, "shareId", shareID, "sessionId", sessionID)
	}

	s.logger.Info("Share created", "shareId", shareID, "sessionId", sessionID, "orgId", orgID, "userId", userID)

	return share, nil
}

// GetShare retrieves a share by ID
func (s *RedisShareStore) GetShare(shareID string) (*ShareMetadata, error) {
	shareKey := fmt.Sprintf("share:%s", shareID)
	
	shareJSON, err := s.client.Get(s.ctx, shareKey).Result()
	if err == redis.Nil {
		return nil, fmt.Errorf("share not found")
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get share from Redis: %w", err)
	}

	var share ShareMetadata
	if err := json.Unmarshal([]byte(shareJSON), &share); err != nil {
		return nil, fmt.Errorf("failed to unmarshal share: %w", err)
	}

	// Check if expired (double-check even though Redis TTL should handle this)
	if share.ExpiresAt != nil && share.ExpiresAt.Before(time.Now()) {
		// Delete expired share
		s.client.Del(s.ctx, shareKey)
		return nil, fmt.Errorf("share expired")
	}

	return &share, nil
}

// DeleteShare removes a share
func (s *RedisShareStore) DeleteShare(shareID string) error {
	// First get the share to find the session ID
	share, err := s.GetShare(shareID)
	if err != nil {
		return err
	}

	shareKey := fmt.Sprintf("share:%s", shareID)
	
	// Delete share from Redis
	if err := s.client.Del(s.ctx, shareKey).Err(); err != nil {
		return fmt.Errorf("failed to delete share from Redis: %w", err)
	}

	// Remove from session index
	sessionIndexKey := fmt.Sprintf("session:%s:shares", share.SessionID)
	if err := s.client.SRem(s.ctx, sessionIndexKey, shareID).Err(); err != nil {
		// Log error but don't fail - the share is already deleted
		s.logger.Warn("Failed to remove share from session index", "error", err, "shareId", shareID, "sessionId", share.SessionID)
	}

	s.logger.Info("Share deleted", "shareId", shareID)
	return nil
}

// GetSharesBySession returns all active shares for a session
func (s *RedisShareStore) GetSharesBySession(sessionID string) []*ShareMetadata {
	sessionIndexKey := fmt.Sprintf("session:%s:shares", sessionID)
	
	// Get all share IDs for this session
	shareIDs, err := s.client.SMembers(s.ctx, sessionIndexKey).Result()
	if err != nil {
		s.logger.Warn("Failed to get share IDs from session index", "error", err, "sessionId", sessionID)
		return []*ShareMetadata{}
	}

	if len(shareIDs) == 0 {
		return []*ShareMetadata{}
	}

	// Build keys for MGET
	keys := make([]string, len(shareIDs))
	for i, shareID := range shareIDs {
		keys[i] = fmt.Sprintf("share:%s", shareID)
	}

	// Get all shares in one operation
	values, err := s.client.MGet(s.ctx, keys...).Result()
	if err != nil {
		s.logger.Warn("Failed to get shares from Redis", "error", err, "sessionId", sessionID)
		return []*ShareMetadata{}
	}

	var shares []*ShareMetadata
	now := time.Now()

	for i, value := range values {
		if value == nil {
			// Share was deleted or expired, remove from index
			s.client.SRem(s.ctx, sessionIndexKey, shareIDs[i])
			continue
		}

		shareJSON, ok := value.(string)
		if !ok {
			s.logger.Warn("Invalid share data type", "shareId", shareIDs[i])
			continue
		}

		var share ShareMetadata
		if err := json.Unmarshal([]byte(shareJSON), &share); err != nil {
			s.logger.Warn("Failed to unmarshal share", "error", err, "shareId", shareIDs[i])
			continue
		}

		// Only include non-expired shares
		if share.ExpiresAt == nil || share.ExpiresAt.After(now) {
			shares = append(shares, &share)
		} else {
			// Share expired, clean it up
			s.client.Del(s.ctx, keys[i])
			s.client.SRem(s.ctx, sessionIndexKey, shareIDs[i])
		}
	}

	return shares
}

// CleanupExpired removes all expired shares (no-op for Redis as TTL handles this)
func (s *RedisShareStore) CleanupExpired() {
	// Redis TTL automatically handles expiration, so this is a no-op
	// However, we can clean up stale entries in session index sets
	// This is optional and can be done periodically if needed
}

// checkRateLimit checks if user has exceeded rate limit (50 shares per hour) using Redis
func (s *RedisShareStore) checkRateLimit(userID int64) bool {
	rateLimitKey := fmt.Sprintf("ratelimit:%d", userID)
	
	// Increment counter
	count, err := s.client.Incr(s.ctx, rateLimitKey).Result()
	if err != nil {
		s.logger.Warn("Failed to increment rate limit counter", "error", err, "userId", userID)
		// Allow on error to avoid blocking legitimate requests
		return true
	}

	// Set TTL to 1 hour on first increment
	if count == 1 {
		if err := s.client.Expire(s.ctx, rateLimitKey, time.Hour).Err(); err != nil {
			s.logger.Warn("Failed to set rate limit TTL", "error", err, "userId", userID)
		}
	}

	// Check if limit exceeded (50 shares per hour)
	if count > 50 {
		return false
	}

	return true
}
