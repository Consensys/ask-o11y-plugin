package plugin

import (
	"consensys-asko11y-app/pkg/agent"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	"github.com/redis/go-redis/v9"
)

var (
	errApprovalNotPending     = errors.New("approval is not pending")
	errApprovalAlreadyPending = errors.New("approval already pending")
)

type approvalConflictError struct {
	decision string
}

func (e *approvalConflictError) Error() string {
	if e.decision == "" {
		return "approval already resolved"
	}
	return fmt.Sprintf("approval already resolved as %s", e.decision)
}

type ApprovalBroker interface {
	Register(ctx context.Context, runID string, request agent.ApprovalRequestEvent) (agent.ApprovalWaitFunc, error)
	Resolve(ctx context.Context, runID string, resolved agent.ApprovalResolvedEvent) (agent.ApprovalResolvedEvent, error)
	Close()
}

type InMemoryApprovalBroker struct {
	mu       sync.Mutex
	waiters  map[string]map[string]chan agent.ApprovalResolvedEvent
	resolved map[string]map[string]agent.ApprovalResolvedEvent
	closed   bool
}

func NewInMemoryApprovalBroker() *InMemoryApprovalBroker {
	return &InMemoryApprovalBroker{
		waiters:  make(map[string]map[string]chan agent.ApprovalResolvedEvent),
		resolved: make(map[string]map[string]agent.ApprovalResolvedEvent),
	}
}

func (b *InMemoryApprovalBroker) Register(ctx context.Context, runID string, request agent.ApprovalRequestEvent) (agent.ApprovalWaitFunc, error) {
	if !isValidApprovalID(request.ApprovalID) {
		return nil, fmt.Errorf("invalid approval id")
	}

	ch := make(chan agent.ApprovalResolvedEvent, 1)
	b.mu.Lock()
	defer b.mu.Unlock()

	if b.closed {
		return nil, fmt.Errorf("approval broker closed")
	}
	if resolved, exists := b.resolved[runID][request.ApprovalID]; exists {
		return func(context.Context) (agent.ApprovalResolvedEvent, error) {
			return resolved, nil
		}, nil
	}
	if b.waiters[runID] == nil {
		b.waiters[runID] = make(map[string]chan agent.ApprovalResolvedEvent)
	}
	if _, exists := b.waiters[runID][request.ApprovalID]; exists {
		return nil, errApprovalAlreadyPending
	}

	b.waiters[runID][request.ApprovalID] = ch

	return func(waitCtx context.Context) (agent.ApprovalResolvedEvent, error) {
		defer b.removeWaiter(runID, request.ApprovalID)
		timer := time.NewTimer(approvalTimeout)
		defer timer.Stop()

		select {
		case resolved, ok := <-ch:
			if !ok {
				return agent.ApprovalResolvedEvent{}, fmt.Errorf("approval channel closed")
			}
			return resolved, nil
		case <-timer.C:
			return agent.ApprovalResolvedEvent{
				ApprovalID: request.ApprovalID,
				Decision:   "rejected",
				Comment:    "approval timed out",
				ResolvedAt: time.Now().UTC().Format(time.RFC3339),
			}, nil
		case <-waitCtx.Done():
			return agent.ApprovalResolvedEvent{}, waitCtx.Err()
		case <-ctx.Done():
			return agent.ApprovalResolvedEvent{}, ctx.Err()
		}
	}, nil
}

func (b *InMemoryApprovalBroker) Resolve(ctx context.Context, runID string, resolved agent.ApprovalResolvedEvent) (agent.ApprovalResolvedEvent, error) {
	b.mu.Lock()
	defer b.mu.Unlock()

	if existing, ok := b.resolved[runID][resolved.ApprovalID]; ok {
		if existing.Decision == resolved.Decision {
			return existing, nil
		}
		return agent.ApprovalResolvedEvent{}, &approvalConflictError{decision: existing.Decision}
	}

	waiters := b.waiters[runID]
	ch := waiters[resolved.ApprovalID]
	if ch == nil {
		return agent.ApprovalResolvedEvent{}, errApprovalNotPending
	}
	if b.resolved[runID] == nil {
		b.resolved[runID] = make(map[string]agent.ApprovalResolvedEvent)
	}

	select {
	case ch <- resolved:
		b.resolved[runID][resolved.ApprovalID] = resolved
		return resolved, nil
	case <-ctx.Done():
		return agent.ApprovalResolvedEvent{}, ctx.Err()
	default:
		return agent.ApprovalResolvedEvent{}, fmt.Errorf("approval delivery queue is full")
	}
}

func (b *InMemoryApprovalBroker) Close() {
	b.mu.Lock()
	defer b.mu.Unlock()

	if b.closed {
		return
	}
	b.closed = true
	for _, waiters := range b.waiters {
		for _, ch := range waiters {
			close(ch)
		}
	}
	b.waiters = nil
	b.resolved = nil
}

func (b *InMemoryApprovalBroker) removeWaiter(runID, approvalID string) {
	b.mu.Lock()
	defer b.mu.Unlock()

	waiters := b.waiters[runID]
	if waiters == nil {
		return
	}
	delete(waiters, approvalID)
	if len(waiters) == 0 {
		delete(b.waiters, runID)
	}
}

type RedisApprovalBroker struct {
	ctx    context.Context
	client *redis.Client
	logger log.Logger
}

func NewRedisApprovalBroker(ctx context.Context, client *redis.Client, logger log.Logger) *RedisApprovalBroker {
	return &RedisApprovalBroker{
		ctx:    ctx,
		client: client,
		logger: logger,
	}
}

func approvalPendingKey(runID, approvalID string) string {
	return fmt.Sprintf("approval:%s:%s:pending", runID, approvalID)
}

func approvalResolvedKey(runID, approvalID string) string {
	return fmt.Sprintf("approval:%s:%s:resolved", runID, approvalID)
}

func approvalQueueKey(runID, approvalID string) string {
	return fmt.Sprintf("approval:%s:%s:queue", runID, approvalID)
}

func approvalRedisTTL() time.Duration {
	return approvalTimeout + 5*time.Minute
}

var registerApprovalScript = redis.NewScript(`
local resolved = redis.call("GET", KEYS[3])
if resolved then
  return {"resolved", resolved}
end
if redis.call("EXISTS", KEYS[1]) == 1 then
  return {"pending", ""}
end
redis.call("DEL", KEYS[2])
redis.call("SET", KEYS[1], ARGV[1], "EX", ARGV[2])
return {"registered", ""}
`)

func (b *RedisApprovalBroker) Register(ctx context.Context, runID string, request agent.ApprovalRequestEvent) (agent.ApprovalWaitFunc, error) {
	if !isValidApprovalID(request.ApprovalID) {
		return nil, fmt.Errorf("invalid approval id")
	}

	pendingJSON, err := json.Marshal(request)
	if err != nil {
		return nil, fmt.Errorf("marshal approval request: %w", err)
	}

	registerCtx, cancel := redisContext(b.ctx, RedisOpTimeout)
	defer cancel()
	registration, err := registerApprovalScript.Run(registerCtx, b.client, []string{
		approvalPendingKey(runID, request.ApprovalID),
		approvalQueueKey(runID, request.ApprovalID),
		approvalResolvedKey(runID, request.ApprovalID),
	}, pendingJSON, int64(approvalRedisTTL().Seconds())).Slice()
	if err != nil {
		return nil, fmt.Errorf("register approval in redis: %w", err)
	}
	if len(registration) != 2 {
		return nil, fmt.Errorf("malformed redis approval registration")
	}
	status, _ := registration[0].(string)
	payload, _ := registration[1].(string)
	switch status {
	case "registered":
	case "resolved":
		var existing agent.ApprovalResolvedEvent
		if err := json.Unmarshal([]byte(payload), &existing); err != nil {
			return nil, fmt.Errorf("decode existing approval decision: %w", err)
		}
		return func(context.Context) (agent.ApprovalResolvedEvent, error) {
			return existing, nil
		}, nil
	case "pending":
		return nil, errApprovalAlreadyPending
	default:
		return nil, fmt.Errorf("unknown redis approval registration status %q", status)
	}

	return func(waitCtx context.Context) (agent.ApprovalResolvedEvent, error) {
		defer b.cleanupPending(runID, request.ApprovalID)

		queueKey := approvalQueueKey(runID, request.ApprovalID)
		result, err := b.client.BLPop(waitCtx, approvalTimeout, queueKey).Result()
		if err == redis.Nil {
			return agent.ApprovalResolvedEvent{
				ApprovalID: request.ApprovalID,
				Decision:   "rejected",
				Comment:    "approval timed out",
				ResolvedAt: time.Now().UTC().Format(time.RFC3339),
			}, nil
		}
		if err != nil {
			return agent.ApprovalResolvedEvent{}, fmt.Errorf("wait for approval decision: %w", err)
		}
		if len(result) != 2 {
			return agent.ApprovalResolvedEvent{}, fmt.Errorf("malformed approval queue response")
		}

		var resolved agent.ApprovalResolvedEvent
		if err := json.Unmarshal([]byte(result[1]), &resolved); err != nil {
			return agent.ApprovalResolvedEvent{}, fmt.Errorf("decode approval decision: %w", err)
		}
		return resolved, nil
	}, nil
}

var resolveApprovalScript = redis.NewScript(`
local resolved = redis.call("GET", KEYS[2])
if resolved then
  return {"resolved", resolved}
end
if redis.call("EXISTS", KEYS[1]) == 0 then
  return {"missing", ""}
end
redis.call("SET", KEYS[2], ARGV[1], "EX", ARGV[2])
redis.call("RPUSH", KEYS[3], ARGV[1])
redis.call("EXPIRE", KEYS[3], ARGV[2])
return {"stored", ARGV[1]}
`)

func (b *RedisApprovalBroker) Resolve(ctx context.Context, runID string, resolved agent.ApprovalResolvedEvent) (agent.ApprovalResolvedEvent, error) {
	resolvedJSON, err := json.Marshal(resolved)
	if err != nil {
		return agent.ApprovalResolvedEvent{}, fmt.Errorf("marshal approval decision: %w", err)
	}

	keys := []string{
		approvalPendingKey(runID, resolved.ApprovalID),
		approvalResolvedKey(runID, resolved.ApprovalID),
		approvalQueueKey(runID, resolved.ApprovalID),
	}
	ttlSeconds := int64(approvalRedisTTL().Seconds())
	resolveCtx, cancel := redisContext(ctx, RedisOpTimeout)
	defer cancel()
	result, err := resolveApprovalScript.Run(resolveCtx, b.client, keys, resolvedJSON, ttlSeconds).Slice()
	if err != nil {
		return agent.ApprovalResolvedEvent{}, fmt.Errorf("resolve approval in redis: %w", err)
	}
	if len(result) != 2 {
		return agent.ApprovalResolvedEvent{}, fmt.Errorf("malformed redis approval resolution")
	}

	status, _ := result[0].(string)
	payload, _ := result[1].(string)
	switch status {
	case "stored":
		return resolved, nil
	case "resolved":
		var existing agent.ApprovalResolvedEvent
		if err := json.Unmarshal([]byte(payload), &existing); err != nil {
			return agent.ApprovalResolvedEvent{}, fmt.Errorf("decode existing approval decision: %w", err)
		}
		if existing.Decision == resolved.Decision {
			return existing, nil
		}
		return agent.ApprovalResolvedEvent{}, &approvalConflictError{decision: existing.Decision}
	case "missing":
		return agent.ApprovalResolvedEvent{}, errApprovalNotPending
	default:
		return agent.ApprovalResolvedEvent{}, fmt.Errorf("unknown redis approval resolution status %q", status)
	}
}

func (b *RedisApprovalBroker) Close() {}

func (b *RedisApprovalBroker) cleanupPending(runID, approvalID string) {
	ctx, cancel := redisContext(b.ctx, RedisOpTimeout)
	defer cancel()
	if err := b.client.Del(ctx, approvalPendingKey(runID, approvalID), approvalQueueKey(runID, approvalID)).Err(); err != nil {
		b.logger.Warn("Failed to clean up approval keys", "error", err, "runId", runID, "approvalId", approvalID)
	}
}
