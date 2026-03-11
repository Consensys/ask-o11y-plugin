package plugin

import (
	"context"
	"testing"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
)

func TestNewPlugin_RedisFallback(t *testing.T) {
	settings := backend.AppInstanceSettings{
		JSONData:               []byte(`{"mcpServers":[]}`),
		DecryptedSecureJSONData: map[string]string{"redisURL": "redis://localhost:9999/0"},
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

	if p.redisClient != nil {
		p.redisClient.Close()
	}
}

func TestNewPlugin_RedisSuccess(t *testing.T) {
	probe, err := createRedisClient(log.DefaultLogger, "redis://localhost:6379/15")
	if err != nil {
		t.Skipf("Redis not available: %v", err)
	}
	if pingErr := probe.Ping(context.Background()).Err(); pingErr != nil {
		probe.Close()
		t.Skipf("Redis not available: %v", pingErr)
	}
	probe.Close()

	settings := backend.AppInstanceSettings{
		JSONData:               []byte(`{"mcpServers":[]}`),
		DecryptedSecureJSONData: map[string]string{"redisURL": "redis://localhost:6379/15"},
	}
	plugin, err := NewPlugin(context.Background(), settings)
	if err != nil {
		t.Fatalf("Failed to create plugin: %v", err)
	}
	p := plugin.(*Plugin)
	defer func() {
		if p.redisClient != nil {
			p.redisClient.Close()
		}
	}()

	if !p.usingRedis {
		t.Error("Should be using Redis when connection succeeds")
	}
	if p.shareStore == nil {
		t.Error("ShareStore should be non-nil when using Redis")
	}
}

func TestCreateRedisClient_WithURL(t *testing.T) {
	client, err := createRedisClient(log.DefaultLogger, "redis://localhost:6379/15")
	if err != nil {
		t.Skipf("Redis not available for testing: %v", err)
	}
	defer client.Close()

	ctx := context.Background()
	if err := client.Ping(ctx).Err(); err != nil {
		t.Skipf("Redis not available for testing: %v", err)
	}
}

func TestCreateRedisClient_DefaultURL(t *testing.T) {
	client, err := createRedisClient(log.DefaultLogger, "")
	if err != nil {
		t.Fatalf("Expected client creation to succeed: %v", err)
	}
	defer client.Close()

	if client.Options().Addr != "localhost:6379" {
		t.Errorf("Expected default addr localhost:6379, got %s", client.Options().Addr)
	}
	if client.Options().DB != 0 {
		t.Errorf("Expected default DB 0, got %d", client.Options().DB)
	}
}

func TestCreateRedisClient_InvalidURL(t *testing.T) {
	_, err := createRedisClient(log.DefaultLogger, "not-a-valid-url")
	if err == nil {
		t.Fatal("Expected error for invalid URL")
	}
}
