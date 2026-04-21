package oauth

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	"github.com/redis/go-redis/v9"

	"consensys-asko11y-app/pkg/mcp"
)

// DynamicServer is the persisted record for an MCP server added through the
// UI at runtime (rather than via provisioning YAML).
type DynamicServer struct {
	Config                  mcp.ServerConfig `json:"config"`
	PresetID                string           `json:"presetID,omitempty"`
	RegistrationClientURI   string           `json:"registrationClientURI,omitempty"`
	RegistrationAccessToken string           `json:"registrationAccessToken,omitempty"`
}

// DynamicServerStore persists runtime-added MCP server records so they
// survive plugin restarts.
type DynamicServerStore interface {
	Put(ctx context.Context, server DynamicServer) error
	Delete(ctx context.Context, serverID string) error
	List(ctx context.Context) ([]DynamicServer, error)
}

// InMemoryDynamicServerStore is sufficient for single-replica dev; records
// are lost on plugin restart.
type InMemoryDynamicServerStore struct {
	mu      sync.RWMutex
	records map[string]DynamicServer
}

func NewInMemoryDynamicServerStore() *InMemoryDynamicServerStore {
	return &InMemoryDynamicServerStore{records: map[string]DynamicServer{}}
}

func (s *InMemoryDynamicServerStore) Put(_ context.Context, server DynamicServer) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.records[server.Config.ID] = server
	return nil
}

func (s *InMemoryDynamicServerStore) Delete(_ context.Context, serverID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.records, serverID)
	return nil
}

func (s *InMemoryDynamicServerStore) List(_ context.Context) ([]DynamicServer, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]DynamicServer, 0, len(s.records))
	for _, v := range s.records {
		out = append(out, v)
	}
	return out, nil
}

// RedisDynamicServerStore persists dynamic server records under a single
// Redis hash so list operations are one round-trip.
type RedisDynamicServerStore struct {
	client *redis.Client
	logger log.Logger
	ctx    context.Context
}

const redisDynamicServersKey = "mcp_dynamic_servers"

func NewRedisDynamicServerStore(ctx context.Context, client *redis.Client, logger log.Logger) *RedisDynamicServerStore {
	return &RedisDynamicServerStore{client: client, logger: logger, ctx: ctx}
}

func (s *RedisDynamicServerStore) Put(ctx context.Context, server DynamicServer) error {
	raw, err := json.Marshal(server)
	if err != nil {
		return fmt.Errorf("encode dynamic server: %w", err)
	}
	if err := s.client.HSet(ctx, redisDynamicServersKey, server.Config.ID, raw).Err(); err != nil {
		return fmt.Errorf("redis hset: %w", err)
	}
	return nil
}

func (s *RedisDynamicServerStore) Delete(ctx context.Context, serverID string) error {
	if err := s.client.HDel(ctx, redisDynamicServersKey, serverID).Err(); err != nil {
		return fmt.Errorf("redis hdel: %w", err)
	}
	return nil
}

func (s *RedisDynamicServerStore) List(ctx context.Context) ([]DynamicServer, error) {
	m, err := s.client.HGetAll(ctx, redisDynamicServersKey).Result()
	if err != nil && !errors.Is(err, redis.Nil) {
		return nil, fmt.Errorf("redis hgetall: %w", err)
	}
	out := make([]DynamicServer, 0, len(m))
	for _, raw := range m {
		var v DynamicServer
		if err := json.Unmarshal([]byte(raw), &v); err != nil {
			s.logger.Warn("skip corrupt dynamic server record", "err", err)
			continue
		}
		out = append(out, v)
	}
	return out, nil
}
