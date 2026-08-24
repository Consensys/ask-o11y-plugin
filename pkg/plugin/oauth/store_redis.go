package oauth

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	"github.com/redis/go-redis/v9"
)

// RedisUserTokenStore persists per-user OAuth tokens in Redis so they survive
// plugin restarts and are shared across Grafana replicas.
type RedisUserTokenStore struct {
	client *redis.Client
	logger log.Logger
}

func NewRedisUserTokenStore(client *redis.Client, logger log.Logger) *RedisUserTokenStore {
	return &RedisUserTokenStore{client: client, logger: logger}
}

func (s *RedisUserTokenStore) Get(ctx context.Context, serverID string, userID int64) (Token, bool, error) {
	raw, err := s.client.Get(ctx, tokenRedisKey(serverID, userID)).Result()
	if errors.Is(err, redis.Nil) {
		return Token{}, false, nil
	}
	if err != nil {
		return Token{}, false, fmt.Errorf("redis get token: %w", err)
	}
	var t Token
	if err := json.Unmarshal([]byte(raw), &t); err != nil {
		return Token{}, false, fmt.Errorf("decode token: %w", err)
	}
	return t, true, nil
}

func (s *RedisUserTokenStore) Put(ctx context.Context, serverID string, userID int64, token Token) error {
	raw, err := json.Marshal(token)
	if err != nil {
		return fmt.Errorf("encode token: %w", err)
	}
	// Keep the record alive past access-token expiry so the refresh token
	// stays usable; the manager refreshes lazily on the next call. A zero
	// ExpiresAt means the provider's token never expires (e.g. GitHub OAuth
	// apps) — persist it without a TTL so the connection doesn't silently
	// lapse; disconnect and server deletion still remove it explicitly.
	var ttl time.Duration // 0 = no expiration
	if !token.ExpiresAt.IsZero() {
		ttl = time.Until(token.ExpiresAt) + 30*24*time.Hour
		if ttl <= 0 {
			ttl = 30 * 24 * time.Hour
		}
	}
	if err := s.client.Set(ctx, tokenRedisKey(serverID, userID), raw, ttl).Err(); err != nil {
		return fmt.Errorf("redis set token: %w", err)
	}
	return nil
}

func (s *RedisUserTokenStore) Delete(ctx context.Context, serverID string, userID int64) error {
	if err := s.client.Del(ctx, tokenRedisKey(serverID, userID)).Err(); err != nil {
		return fmt.Errorf("redis del token: %w", err)
	}
	return nil
}

func (s *RedisUserTokenStore) DeleteServer(ctx context.Context, serverID string) error {
	pattern := "mcp_oauth:" + serverIDEscape(serverID) + ":*"
	iter := s.client.Scan(ctx, 0, pattern, 100).Iterator()
	for iter.Next(ctx) {
		if err := s.client.Del(ctx, iter.Val()).Err(); err != nil {
			return fmt.Errorf("redis del token %s: %w", iter.Val(), err)
		}
	}
	if err := iter.Err(); err != nil {
		return fmt.Errorf("redis scan tokens: %w", err)
	}
	return nil
}
