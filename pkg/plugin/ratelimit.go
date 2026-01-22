package plugin

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	"github.com/redis/go-redis/v9"
	"golang.org/x/time/rate"
)

// RateLimiter defines the interface for rate limiting implementations
type RateLimiter interface {
	// CheckLimit returns true if the request is allowed, false if rate limit exceeded
	CheckLimit(userID int64) bool
}

// InMemoryRateLimiter implements rate limiting using in-memory token buckets
type InMemoryRateLimiter struct {
	mu       sync.RWMutex
	limiters map[int64]*userLimiter
	logger   log.Logger
}

type userLimiter struct {
	limiter   *rate.Limiter
	lastReset time.Time
}

// NewInMemoryRateLimiter creates a new in-memory rate limiter
func NewInMemoryRateLimiter(logger log.Logger) *InMemoryRateLimiter {
	return &InMemoryRateLimiter{
		limiters: make(map[int64]*userLimiter),
		logger:   logger,
	}
}

// CheckLimit checks if user has exceeded rate limit using in-memory token bucket
func (r *InMemoryRateLimiter) CheckLimit(userID int64) bool {
	r.mu.Lock()
	defer r.mu.Unlock()

	rl, exists := r.limiters[userID]
	now := time.Now()

	// Reset if more than the rate limit window has passed
	if exists && now.Sub(rl.lastReset) > ShareRateLimitWindow {
		rl.limiter = rate.NewLimiter(rate.Every(ShareRateLimitWindow/ShareRateLimitPerHour), ShareRateLimitPerHour)
		rl.lastReset = now
	}

	// Create new limiter if doesn't exist
	if !exists {
		rl = &userLimiter{
			limiter:   rate.NewLimiter(rate.Every(ShareRateLimitWindow/ShareRateLimitPerHour), ShareRateLimitPerHour),
			lastReset: now,
		}
		r.limiters[userID] = rl
	}

	return rl.limiter.Allow()
}

// RedisRateLimiter implements rate limiting using Redis
type RedisRateLimiter struct {
	client *redis.Client
	logger log.Logger
}

// NewRedisRateLimiter creates a new Redis-backed rate limiter
func NewRedisRateLimiter(client *redis.Client, logger log.Logger) *RedisRateLimiter {
	return &RedisRateLimiter{
		client: client,
		logger: logger,
	}
}

// CheckLimit checks if user has exceeded rate limit using Redis
func (r *RedisRateLimiter) CheckLimit(userID int64) bool {
	rateLimitKey := fmt.Sprintf("ratelimit:%d", userID)

	// Increment counter
	ctx, cancel := getContextWithTimeout(RedisOpTimeout)
	defer cancel()
	count, err := r.client.Incr(ctx, rateLimitKey).Result()
	if err != nil {
		r.logger.Warn("Failed to increment rate limit counter", "error", err, "userId", userID)
		// Allow on error to avoid blocking legitimate requests
		return true
	}

	// Set TTL on first increment
	if count == 1 {
		ctx2, cancel2 := getContextWithTimeout(RedisOpTimeout)
		defer cancel2()
		if err := r.client.Expire(ctx2, rateLimitKey, ShareRateLimitWindow).Err(); err != nil {
			r.logger.Warn("Failed to set rate limit TTL", "error", err, "userId", userID)
		}
	}

	// Check if limit exceeded
	if count > ShareRateLimitPerHour {
		return false
	}

	return true
}

// getContextWithTimeout is a helper for creating contexts with timeouts
// Note: This is a package-level helper used by both rate limiters and share stores
func getContextWithTimeout(timeout time.Duration) (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.Background(), timeout)
}
