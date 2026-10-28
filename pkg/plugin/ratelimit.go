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

// maxTrackedUsers bounds the in-memory limiter map so a flood of distinct
// user IDs cannot grow it without limit. On overflow the map is reset, which
// temporarily widens limits for a few users but keeps memory bounded.
const maxTrackedUsers = 10000

// InMemoryRateLimiter implements rate limiting using in-memory token buckets
type InMemoryRateLimiter struct {
	mu       sync.RWMutex
	limiters map[int64]*userLimiter
	limit    int
	window   time.Duration
	logger   log.Logger
}

type userLimiter struct {
	limiter   *rate.Limiter
	lastReset time.Time
}

// NewInMemoryRateLimiter creates a new in-memory rate limiter with the default
// (share) limits.
func NewInMemoryRateLimiter(logger log.Logger) *InMemoryRateLimiter {
	return NewScopedInMemoryRateLimiter(logger, ShareRateLimitPerHour, ShareRateLimitWindow)
}

// NewScopedInMemoryRateLimiter creates an in-memory rate limiter with custom
// limits, e.g. for agent runs or direct tool calls.
func NewScopedInMemoryRateLimiter(logger log.Logger, limit int, window time.Duration) *InMemoryRateLimiter {
	return &InMemoryRateLimiter{
		limiters: make(map[int64]*userLimiter),
		limit:    limit,
		window:   window,
		logger:   logger,
	}
}

// CheckLimit checks if user has exceeded rate limit using in-memory token bucket
func (r *InMemoryRateLimiter) CheckLimit(userID int64) bool {
	r.mu.Lock()
	defer r.mu.Unlock()

	if len(r.limiters) >= maxTrackedUsers {
		r.logger.Warn("Rate limiter tracked-user map full, resetting", "maxTrackedUsers", maxTrackedUsers)
		r.limiters = make(map[int64]*userLimiter)
	}

	rl, exists := r.limiters[userID]
	now := time.Now()

	// Reset if more than the rate limit window has passed
	if exists && now.Sub(rl.lastReset) > r.window {
		rl.limiter = rate.NewLimiter(rate.Every(r.window/time.Duration(r.limit)), r.limit)
		rl.lastReset = now
	}

	// Create new limiter if doesn't exist
	if !exists {
		rl = &userLimiter{
			limiter:   rate.NewLimiter(rate.Every(r.window/time.Duration(r.limit)), r.limit),
			lastReset: now,
		}
		r.limiters[userID] = rl
	}

	return rl.limiter.Allow()
}

// RedisRateLimiter implements rate limiting using Redis
type RedisRateLimiter struct {
	client    *redis.Client
	logger    log.Logger
	ctx       context.Context
	keyPrefix string
	limit     int64
	window    time.Duration
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

// NewRedisRateLimiter creates a new Redis-backed rate limiter with the default
// (share) key prefix and limits.
func NewRedisRateLimiter(ctx context.Context, client *redis.Client, logger log.Logger) *RedisRateLimiter {
	return NewScopedRedisRateLimiter(ctx, client, logger, "ratelimit", ShareRateLimitPerHour, ShareRateLimitWindow)
}

// NewScopedRedisRateLimiter creates a Redis-backed rate limiter with a custom
// key prefix and limits, so different endpoint classes get independent counters.
func NewScopedRedisRateLimiter(ctx context.Context, client *redis.Client, logger log.Logger, keyPrefix string, limit int, window time.Duration) *RedisRateLimiter {
	return &RedisRateLimiter{
		client:    client,
		logger:    logger,
		ctx:       ctx,
		keyPrefix: keyPrefix,
		limit:     int64(limit),
		window:    window,
	}
}

// CheckLimit checks if user has exceeded rate limit using Redis
func (r *RedisRateLimiter) CheckLimit(userID int64) bool {
	rateLimitKey := fmt.Sprintf("%s:%d", r.keyPrefix, userID)

	ctx, cancel := context.WithTimeout(r.ctx, RedisOpTimeout)
	defer cancel()
	count, err := r.client.Eval(
		ctx,
		redisRateLimitScript,
		[]string{rateLimitKey},
		r.window.Milliseconds(),
	).Int64()
	if err != nil {
		r.logger.Warn("Failed to update rate limit counter, denying request", "error", err, "userId", userID)
		// Fail closed: allowing on error would let an attacker disable rate
		// limiting by degrading Redis. Rate-limited endpoints return 429 here.
		return false
	}

	// Check if limit exceeded
	if count > r.limit {
		return false
	}

	return true
}

func redisContext(parent context.Context, timeout time.Duration) (context.Context, context.CancelFunc) {
	return context.WithTimeout(parent, timeout)
}
