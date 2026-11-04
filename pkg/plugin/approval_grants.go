package plugin

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	"github.com/redis/go-redis/v9"
)

type ApprovalGrant struct {
	ToolName  string    `json:"toolName"`
	Risk      string    `json:"risk,omitempty"`
	Reason    string    `json:"reason,omitempty"`
	SessionID string    `json:"sessionId"`
	CreatedAt time.Time `json:"createdAt"`
}

type ApprovalGrantStore interface {
	Has(ctx context.Context, sessionID, toolName string) (bool, error)
	Grant(ctx context.Context, grant ApprovalGrant) error
	DeleteSession(ctx context.Context, sessionID string) error
	Close()
}

type InMemoryApprovalGrantStore struct {
	mu     sync.RWMutex
	grants map[string]ApprovalGrant
}

func NewInMemoryApprovalGrantStore() *InMemoryApprovalGrantStore {
	return &InMemoryApprovalGrantStore{grants: make(map[string]ApprovalGrant)}
}

func approvalGrantKey(sessionID, toolName string) string {
	return fmt.Sprintf("%s:%s", strings.TrimSpace(sessionID), normalizeApprovalToolName(toolName))
}

func normalizeApprovalToolName(toolName string) string {
	return strings.ToLower(strings.TrimSpace(toolName))
}

func (s *InMemoryApprovalGrantStore) Has(ctx context.Context, sessionID, toolName string) (bool, error) {
	if err := ctx.Err(); err != nil {
		return false, err
	}
	if strings.TrimSpace(sessionID) == "" {
		return false, nil
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	_, ok := s.grants[approvalGrantKey(sessionID, toolName)]
	return ok, nil
}

func (s *InMemoryApprovalGrantStore) Grant(ctx context.Context, grant ApprovalGrant) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if normalizeApprovalToolName(grant.ToolName) == "" {
		return fmt.Errorf("tool name is required")
	}
	if strings.TrimSpace(grant.SessionID) == "" {
		return fmt.Errorf("session id is required")
	}
	if grant.CreatedAt.IsZero() {
		grant.CreatedAt = time.Now().UTC()
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.grants[approvalGrantKey(grant.SessionID, grant.ToolName)] = grant
	return nil
}

func (s *InMemoryApprovalGrantStore) Close() {}

// DeleteSession drops every grant that belongs to sessionID, so a deleted
// session leaves no standing approval behind.
func (s *InMemoryApprovalGrantStore) DeleteSession(ctx context.Context, sessionID string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	trimmed := strings.TrimSpace(sessionID)
	if trimmed == "" {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for key, grant := range s.grants {
		if strings.TrimSpace(grant.SessionID) == trimmed {
			delete(s.grants, key)
		}
	}
	return nil
}

type RedisApprovalGrantStore struct {
	ctx    context.Context
	client *redis.Client
	logger log.Logger
}

func NewRedisApprovalGrantStore(ctx context.Context, client *redis.Client, logger log.Logger) *RedisApprovalGrantStore {
	return &RedisApprovalGrantStore{ctx: ctx, client: client, logger: logger}
}

func approvalGrantRedisKey(sessionID string) string {
	return fmt.Sprintf("approval_grants:%s", strings.TrimSpace(sessionID))
}

func (s *RedisApprovalGrantStore) Has(ctx context.Context, sessionID, toolName string) (bool, error) {
	field := normalizeApprovalToolName(toolName)
	if field == "" || strings.TrimSpace(sessionID) == "" {
		return false, nil
	}
	opCtx, cancel := redisContext(ctx, RedisOpTimeout)
	defer cancel()
	exists, err := s.client.HExists(opCtx, approvalGrantRedisKey(sessionID), field).Result()
	if err != nil {
		return false, err
	}
	return exists, nil
}

func (s *RedisApprovalGrantStore) Grant(ctx context.Context, grant ApprovalGrant) error {
	field := normalizeApprovalToolName(grant.ToolName)
	if field == "" {
		return fmt.Errorf("tool name is required")
	}
	if strings.TrimSpace(grant.SessionID) == "" {
		return fmt.Errorf("session id is required")
	}
	if grant.CreatedAt.IsZero() {
		grant.CreatedAt = time.Now().UTC()
	}
	payload, err := json.Marshal(grant)
	if err != nil {
		return fmt.Errorf("marshal approval grant: %w", err)
	}
	opCtx, cancel := redisContext(ctx, RedisOpTimeout)
	defer cancel()
	return s.client.HSet(opCtx, approvalGrantRedisKey(grant.SessionID), field, payload).Err()
}

func (s *RedisApprovalGrantStore) Close() {}

// DeleteSession drops every grant that belongs to sessionID, so a deleted
// session leaves no standing approval behind.
func (s *RedisApprovalGrantStore) DeleteSession(ctx context.Context, sessionID string) error {
	trimmed := strings.TrimSpace(sessionID)
	if trimmed == "" {
		return nil
	}
	opCtx, cancel := redisContext(ctx, RedisOpTimeout)
	defer cancel()
	return s.client.Del(opCtx, approvalGrantRedisKey(trimmed)).Err()
}
