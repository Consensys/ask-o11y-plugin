package plugin

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	"github.com/redis/go-redis/v9"
)

// RedisShareStore manages share metadata storage using Redis
type RedisShareStore struct {
	client      *redis.Client
	logger      log.Logger
	rateLimiter RateLimiter
}

// NewRedisShareStore creates a new Redis-backed share store
func NewRedisShareStore(client *redis.Client, logger log.Logger, rateLimiter RateLimiter) *RedisShareStore {
	return &RedisShareStore{
		client:      client,
		logger:      logger,
		rateLimiter: rateLimiter,
	}
}

// CreateShare creates a new share and returns the share metadata
func (s *RedisShareStore) CreateShare(sessionID string, sessionData []byte, orgID, userID int64, expiresInHours *int) (*ShareMetadata, error) {
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
	expiresAt, ttl := CalculateExpiration(expiresInHours)

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
	ctx, cancel := getContextWithTimeout(RedisOpTimeout)
	defer cancel()
	if err := s.client.Set(ctx, shareKey, shareJSON, ttl).Err(); err != nil {
		return nil, fmt.Errorf("failed to store share in Redis: %w", err)
	}

	// Add share ID to session index set and set/update TTL
	sessionIndexKey := fmt.Sprintf("session:%s:shares", sessionID)
	ctx2, cancel2 := getContextWithTimeout(RedisOpTimeout)
	defer cancel2()
	if err := s.client.SAdd(ctx2, sessionIndexKey, shareID).Err(); err != nil {
		// Log error but don't fail - the share is already stored
		s.logger.Warn("Failed to add share to session index", "error", err, "shareId", shareID, "sessionId", sessionID)
	} else {
		// Set TTL on the session index set to prevent memory leak
		// Check current TTL and only extend if new share has longer TTL
		ctx3, cancel3 := getContextWithTimeout(RedisOpTimeout)
		defer cancel3()
		currentTTL, err := s.client.TTL(ctx3, sessionIndexKey).Result()
		if err != nil {
			s.logger.Warn("Failed to get TTL for session index", "error", err, "sessionId", sessionID)
			// Set TTL anyway to be safe
			ctx4, cancel4 := getContextWithTimeout(RedisOpTimeout)
			defer cancel4()
			s.client.Expire(ctx4, sessionIndexKey, ttl)
		} else if currentTTL == -1 || currentTTL < ttl {
			// No TTL set (-1) or current TTL is shorter than new share's TTL
			ctx4, cancel4 := getContextWithTimeout(RedisOpTimeout)
			defer cancel4()
			if err := s.client.Expire(ctx4, sessionIndexKey, ttl).Err(); err != nil {
				s.logger.Warn("Failed to set TTL on session index", "error", err, "sessionId", sessionID)
			}
		}
	}

	s.logger.Info("Share created", "shareId", shareID, "sessionId", sessionID, "orgId", orgID, "userId", userID)

	return share, nil
}

// GetShare retrieves a share by ID
func (s *RedisShareStore) GetShare(shareID string) (*ShareMetadata, error) {
	shareKey := fmt.Sprintf("share:%s", shareID)

	ctx, cancel := getContextWithTimeout(RedisOpTimeout)
	defer cancel()
	shareJSON, err := s.client.Get(ctx, shareKey).Result()
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
		ctx2, cancel2 := getContextWithTimeout(RedisOpTimeout)
		defer cancel2()
		s.client.Del(ctx2, shareKey)
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
	ctx, cancel := getContextWithTimeout(RedisOpTimeout)
	defer cancel()
	if err := s.client.Del(ctx, shareKey).Err(); err != nil {
		return fmt.Errorf("failed to delete share from Redis: %w", err)
	}

	// Remove from session index
	sessionIndexKey := fmt.Sprintf("session:%s:shares", share.SessionID)
	ctx2, cancel2 := getContextWithTimeout(RedisOpTimeout)
	defer cancel2()
	if err := s.client.SRem(ctx2, sessionIndexKey, shareID).Err(); err != nil {
		// Log error but don't fail - the share is already deleted
		s.logger.Warn("Failed to remove share from session index", "error", err, "shareId", shareID, "sessionId", share.SessionID)
	}

	s.logger.Info("Share deleted", "shareId", shareID)
	return nil
}

// GetSharesBySession returns all active shares for a session
func (s *RedisShareStore) GetSharesBySession(sessionID string) []*ShareMetadata {
	sessionIndexKey := fmt.Sprintf("session:%s:shares", sessionID)

	// Get all share IDs for this session (bulk operation - use longer timeout)
	ctx, cancel := getContextWithTimeout(RedisBulkOpTimeout)
	defer cancel()
	shareIDs, err := s.client.SMembers(ctx, sessionIndexKey).Result()
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

	// Get all shares in one operation (bulk operation - use longer timeout)
	ctx2, cancel2 := getContextWithTimeout(RedisBulkOpTimeout)
	defer cancel2()
	values, err := s.client.MGet(ctx2, keys...).Result()
	if err != nil {
		s.logger.Warn("Failed to get shares from Redis", "error", err, "sessionId", sessionID)
		return []*ShareMetadata{}
	}

	var shares []*ShareMetadata
	now := time.Now()

	for i, value := range values {
		if value == nil {
			// Share was deleted or expired, remove from index
			ctx3, cancel3 := getContextWithTimeout(RedisOpTimeout)
			s.client.SRem(ctx3, sessionIndexKey, shareIDs[i])
			cancel3()
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
			ctx3, cancel3 := getContextWithTimeout(RedisOpTimeout)
			s.client.Del(ctx3, keys[i])
			cancel3()
			ctx4, cancel4 := getContextWithTimeout(RedisOpTimeout)
			s.client.SRem(ctx4, sessionIndexKey, shareIDs[i])
			cancel4()
		}
	}

	// If no shares remain, delete the empty index set to free memory immediately
	if len(shares) == 0 && len(shareIDs) > 0 {
		ctx3, cancel3 := getContextWithTimeout(RedisOpTimeout)
		defer cancel3()
		s.client.Del(ctx3, sessionIndexKey)
	}

	return shares
}

// CleanupExpired removes all expired shares (no-op for Redis as TTL handles this)
func (s *RedisShareStore) CleanupExpired() {
	// Redis TTL automatically handles expiration, so this is a no-op
	// However, we can clean up stale entries in session index sets
	// This is optional and can be done periodically if needed
}

