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
	ctx    context.Context
}

// redisRateLimitScript atomically increments the counter and ensures the
// rate-limit window is attached to the key. The PTTL check also repairs keys
// left without an expiry by older versions if INCR succeeded but EXPIRE failed.
const redisRateLimitScript = `
local count = redis.call("INCR", KEYS[1])
if count == 1 or redis.call("PTTL", KEYS[1]) < 0 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
end
return count
`

// NewRedisRateLimiter creates a new Redis-backed rate limiter
func NewRedisRateLimiter(ctx context.Context, client *redis.Client, logger log.Logger) *RedisRateLimiter {
	return &RedisRateLimiter{
		client: client,
		logger: logger,
		ctx:    ctx,
	}
}

// CheckLimit checks if user has exceeded rate limit using Redis
func (r *RedisRateLimiter) CheckLimit(userID int64) bool {
	rateLimitKey := fmt.Sprintf("ratelimit:%d", userID)

	ctx, cancel := context.WithTimeout(r.ctx, RedisOpTimeout)
	defer cancel()
	count, err := r.client.Eval(
		ctx,
		redisRateLimitScript,
		[]string{rateLimitKey},
		ShareRateLimitWindow.Milliseconds(),
	).Int64()
	if err != nil {
		r.logger.Warn("Failed to update rate limit counter", "error", err, "userId", userID)
		// Allow on error to avoid blocking legitimate requests
		return true
	}

	// Check if limit exceeded
	if count > ShareRateLimitPerHour {
		return false
	}

	return true
}

func redisContext(parent context.Context, timeout time.Duration) (context.Context, context.CancelFunc) {
	return context.WithTimeout(parent, timeout)
}
