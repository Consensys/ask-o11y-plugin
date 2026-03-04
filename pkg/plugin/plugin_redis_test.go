package plugin

import (
	"context"
	"testing"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
)

func TestNewPlugin_RedisFallback(t *testing.T) {
	// Point at a non-existent Redis to verify in-memory fallback.
	settings := backend.AppInstanceSettings{
		JSONData: []byte(`{"mcpServers":[],"redisURL":"redis://localhost:9999/0"}`),
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

	// If Redis IS running locally, verify the plugin can use it.
	settings2 := backend.AppInstanceSettings{
		JSONData: []byte(`{"mcpServers":[],"redisURL":"redis://localhost:6379/15"}`),
	}

	plugin2, err := NewPlugin(ctx, settings2)
	if err != nil {
		t.Fatalf("Failed to create plugin: %v", err)
	}

	p2 := plugin2.(*Plugin)
	if p2.shareStore == nil {
		t.Error("ShareStore should be created")
	}

	if p2.redisClient != nil {
		p2.redisClient.Close()
	}
	if p.redisClient != nil {
		p.redisClient.Close()
	}
}

func TestCreateRedisClient_FromPluginSettings(t *testing.T) {
	settings := PluginSettings{RedisURL: "redis://localhost:6379/15"}
	client, err := createRedisClient(log.DefaultLogger, settings)
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
	client, err := createRedisClient(log.DefaultLogger, PluginSettings{})
	if err != nil {
		t.Fatalf("Expected client creation to succeed: %v", err)
	}
	defer client.Close()

	if client.Options().Addr != "redis:6379" {
		t.Errorf("Expected default addr redis:6379, got %s", client.Options().Addr)
	}
	if client.Options().DB != 0 {
		t.Errorf("Expected default DB 0, got %d", client.Options().DB)
	}
}

func TestCreateRedisClient_InvalidURL(t *testing.T) {
	settings := PluginSettings{RedisURL: "not-a-valid-url"}
	_, err := createRedisClient(log.DefaultLogger, settings)
	if err == nil {
		t.Fatal("Expected error for invalid URL")
	}
}
