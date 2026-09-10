package plugin

import (
	"context"
	"testing"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
)

func TestRedisRateLimiter_RepairsMissingTTL(t *testing.T) {
	client := createTestRedisClient(t)
	defer client.Close()

	ctx := context.Background()
	const userID int64 = 100
	rateLimitKey := "ratelimit:100"

	// Simulate the partial-failure state produced by the old two-command
	// implementation: INCR succeeded, but EXPIRE failed, leaving a live
	// counter with no TTL.
	if err := client.Set(ctx, rateLimitKey, 1, 0).Err(); err != nil {
		t.Fatalf("failed to seed rate-limit key: %v", err)
	}
	if ttl := client.TTL(ctx, rateLimitKey).Val(); ttl != -1 {
		t.Fatalf("expected seeded rate-limit key to have no TTL, got %v", ttl)
	}

	limiter := NewRedisRateLimiter(ctx, client, log.DefaultLogger)
	if allowed := limiter.CheckLimit(userID); !allowed {
		t.Fatal("expected request below the rate limit to be allowed")
	}

	ttl := client.TTL(ctx, rateLimitKey).Val()
	if ttl <= 0 {
		t.Fatalf("expected rate-limit key TTL to be repaired, got %v", ttl)
	}
	if ttl > ShareRateLimitWindow || ttl < ShareRateLimitWindow-time.Minute {
		t.Fatalf("expected TTL close to %v, got %v", ShareRateLimitWindow, ttl)
	}
}
