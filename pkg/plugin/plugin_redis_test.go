package plugin

import (
	"context"
	"os"
	"testing"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
)

func TestNewPlugin_RedisFallback(t *testing.T) {
	// Save original environment
	originalRedisURL := os.Getenv("GF_PLUGIN_ASKO11Y_REDIS")
	originalRedisAddr := os.Getenv("REDIS_ADDR")

	// Clean up after test
	defer func() {
		if originalRedisURL != "" {
			os.Setenv("GF_PLUGIN_ASKO11Y_REDIS", originalRedisURL)
		} else {
			os.Unsetenv("GF_PLUGIN_ASKO11Y_REDIS")
		}
		if originalRedisAddr != "" {
			os.Setenv("REDIS_ADDR", originalRedisAddr)
		} else {
			os.Unsetenv("REDIS_ADDR")
		}
	}()

	// Test 1: Redis unavailable - should fallback to in-memory
	os.Unsetenv("GF_PLUGIN_ASKO11Y_REDIS")
	os.Unsetenv("REDIS_ADDR")
	os.Setenv("REDIS_ADDR", "localhost:9999") // Non-existent Redis

	settings := backend.AppInstanceSettings{
		JSONData: []byte(`{"mcpServers":[]}`),
	}

	ctx := context.Background()
	plugin, err := NewPlugin(ctx, settings)
	if err != nil {
		t.Fatalf("Failed to create plugin: %v", err)
	}

	p := plugin.(*Plugin)
	if p.usingRedis {
		t.Error("Should not be using Redis when connection fails")
	}
	if p.shareStore == nil {
		t.Error("ShareStore should be created (in-memory fallback)")
	}

	// Test 2: Redis available - should use Redis
	// This test requires Redis to be running, so we'll skip if not available
	os.Setenv("REDIS_ADDR", "localhost:6379")
	os.Setenv("REDIS_DB", "15") // Use test database

	plugin2, err := NewPlugin(ctx, settings)
	if err != nil {
		t.Fatalf("Failed to create plugin: %v", err)
	}

	p2 := plugin2.(*Plugin)
	// If Redis is available, it should use it; if not, it will fallback
	// We just verify the plugin initializes successfully in both cases
	if p2.shareStore == nil {
		t.Error("ShareStore should be created")
	}

	// Cleanup
	if p2.redisClient != nil {
		p2.redisClient.Close()
	}
	if p.redisClient != nil {
		p.redisClient.Close()
	}
}

func TestCreateRedisClient_FromURL(t *testing.T) {
	originalRedisURL := os.Getenv("GF_PLUGIN_ASKO11Y_REDIS")
	defer func() {
		if originalRedisURL != "" {
			os.Setenv("GF_PLUGIN_ASKO11Y_REDIS", originalRedisURL)
		} else {
			os.Unsetenv("GF_PLUGIN_ASKO11Y_REDIS")
		}
	}()

	// Test with GF_PLUGIN_ASKO11Y_REDIS
	os.Setenv("GF_PLUGIN_ASKO11Y_REDIS", "redis://localhost:6379/15")
	os.Unsetenv("REDIS_ADDR")
	os.Unsetenv("REDIS_PASSWORD")
	os.Unsetenv("REDIS_DB")

	client, err := createRedisClient(log.DefaultLogger)
	if err != nil {
		t.Skipf("Redis not available for testing: %v", err)
	}
	defer client.Close()

	// Test connection
	ctx := context.Background()
	if err := client.Ping(ctx).Err(); err != nil {
		t.Skipf("Redis not available for testing: %v", err)
	}
}

func TestCreateRedisClient_FromIndividualVars(t *testing.T) {
	originalRedisURL := os.Getenv("GF_PLUGIN_ASKO11Y_REDIS")
	originalRedisAddr := os.Getenv("REDIS_ADDR")
	originalRedisDB := os.Getenv("REDIS_DB")

	defer func() {
		if originalRedisURL != "" {
			os.Setenv("GF_PLUGIN_ASKO11Y_REDIS", originalRedisURL)
		} else {
			os.Unsetenv("GF_PLUGIN_ASKO11Y_REDIS")
		}
		if originalRedisAddr != "" {
			os.Setenv("REDIS_ADDR", originalRedisAddr)
		} else {
			os.Unsetenv("REDIS_ADDR")
		}
		if originalRedisDB != "" {
			os.Setenv("REDIS_DB", originalRedisDB)
		} else {
			os.Unsetenv("REDIS_DB")
		}
	}()

	// Test with individual environment variables
	os.Unsetenv("GF_PLUGIN_ASKO11Y_REDIS")
	os.Setenv("REDIS_ADDR", "localhost:6379")
	os.Setenv("REDIS_DB", "15")

	client, err := createRedisClient(log.DefaultLogger)
	if err != nil {
		t.Skipf("Redis not available for testing: %v", err)
	}
	defer client.Close()

	// Test connection
	ctx := context.Background()
	if err := client.Ping(ctx).Err(); err != nil {
		t.Skipf("Redis not available for testing: %v", err)
	}
}
