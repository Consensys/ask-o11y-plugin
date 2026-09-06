package plugin

import (
	"consensys-asko11y-app/pkg/agent"
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	"github.com/redis/go-redis/v9"
)

type RedisRunStore struct {
	client        *redis.Client
	logger        log.Logger
	mu            sync.RWMutex
	subscriptions map[string]*runSubscription
	heartbeats    map[string]context.CancelFunc
	ctx           context.Context
}

type runSubscription struct {
	broadcaster *RunBroadcaster
	pubsub      *redis.PubSub
	cancel      context.CancelFunc
	refs        int
}

type runStreamMessage struct {
	Kind  string          `json:"kind"`
	Event *agent.SSEEvent `json:"event,omitempty"`
}

const (
	runStreamKindEvent    = "event"
	runStreamKindFinished = "finished"
)

const runInterruptedMessage = "agent run was interrupted before it completed"

func runKey(runID string) string         { return fmt.Sprintf("run:%s", runID) }
func eventsKey(runID string) string      { return fmt.Sprintf("run:%s:events", runID) }
func sequenceKey(runID string) string    { return fmt.Sprintf("run:%s:sequence", runID) }
func runChannelKey(runID string) string  { return fmt.Sprintf("run:%s:channel", runID) }
func heartbeatKey(runID string) string   { return fmt.Sprintf("run:%s:heartbeat", runID) }
func interruptedKey(runID string) string { return fmt.Sprintf("run:%s:interrupted", runID) }
func runIndexKey(userID, orgID int64) string {
	return fmt.Sprintf("runs:user:%d:org:%d", userID, orgID)
}

func NewRedisRunStore(ctx context.Context, client *redis.Client, logger log.Logger) *RedisRunStore {
	return &RedisRunStore{
		client:        client,
		logger:        logger,
		subscriptions: make(map[string]*runSubscription),
		heartbeats:    make(map[string]context.CancelFunc),
		ctx:           ctx,
	}
}

func (s *RedisRunStore) CreateRun(runID string, userID, orgID int64, sessionID ...string) *AgentRun {
	now := time.Now()
	run := &AgentRun{
		RunID:     runID,
		Status:    RunStatusRunning,
		UserID:    userID,
		OrgID:     orgID,
		CreatedAt: now,
		UpdatedAt: now,
		Events:    []agent.SSEEvent{},
		Trace:     &AgentRunTrace{},
	}
	if len(sessionID) > 0 {
		run.SessionID = sessionID[0]
	}

	runJSON, err := json.Marshal(run)
	if err != nil {
		s.logger.Error("Failed to marshal run", "error", err, "runId", runID)
		return run
	}

	ctx, cancel := redisContext(s.ctx, RedisOpTimeout)
	defer cancel()
	pipe := s.client.Pipeline()
	pipe.Set(ctx, runKey(runID), runJSON, RunMaxAge)
	pipe.Set(ctx, heartbeatKey(runID), "1", RunHeartbeatTTL)
	pipe.ZAdd(ctx, runIndexKey(userID, orgID), redis.Z{Score: float64(now.UnixNano()), Member: runID})
	pipe.Expire(ctx, runIndexKey(userID, orgID), RunMaxAge)
	if _, err := pipe.Exec(ctx); err != nil {
		s.logger.Error("Failed to store run in Redis", "error", err, "runId", runID)
	}

	s.startHeartbeat(runID)

	return run
}

func (s *RedisRunStore) startHeartbeat(runID string) {
	ctx, cancel := context.WithCancel(s.ctx)

	s.mu.Lock()
	s.heartbeats[runID] = cancel
	s.mu.Unlock()

	go func() {
		ticker := time.NewTicker(RunHeartbeatInterval)
		defer ticker.Stop()

		for {
			select {
			case <-ticker.C:
				beatCtx, beatCancel := redisContext(ctx, RedisOpTimeout)
				err := s.client.Set(beatCtx, heartbeatKey(runID), "1", RunHeartbeatTTL).Err()
				beatCancel()
				if err != nil {
					s.logger.Warn("Failed to refresh run heartbeat", "error", err, "runId", runID)
				}
			case <-ctx.Done():
				return
			}
		}
	}()
}

func (s *RedisRunStore) stopHeartbeat(runID string) {
	s.mu.Lock()
	cancel, ok := s.heartbeats[runID]
	delete(s.heartbeats, runID)
	s.mu.Unlock()

	if ok {
		cancel()
	}
}

func (s *RedisRunStore) AppendEvent(runID string, event agent.SSEEvent) {
	seqCtx, seqCancel := redisContext(s.ctx, RedisOpTimeout)
	defer seqCancel()

	seq, err := s.client.Incr(seqCtx, sequenceKey(runID)).Result()
	if err != nil {
		s.logger.Error("Failed to increment sequence", "error", err, "runId", runID)
		return
	}
	event.Sequence = seq - 1

	eventJSON, err := json.Marshal(event)
	if err != nil {
		s.logger.Error("Failed to marshal event", "error", err, "runId", runID)
		return
	}

	ek := eventsKey(runID)
	pushCtx, pushCancel := redisContext(s.ctx, RedisOpTimeout)
	defer pushCancel()

	listLen, err := s.client.RPush(pushCtx, ek, eventJSON).Result()
	if err != nil {
		s.logger.Error("Failed to append event to Redis", "error", err, "runId", runID)
		return
	}

	if listLen > int64(RunMaxEventsPerRun) {
		ctx, cancel := redisContext(s.ctx, RedisOpTimeout)
		defer cancel()
		s.client.LTrim(ctx, ek, -int64(RunMaxEventsPerRun), -1)
	}

	s.appendTraceEvent(runID, event)
	s.touchRun(runID)

	s.publish(runID, runStreamMessage{Kind: runStreamKindEvent, Event: &event})
}

func (s *RedisRunStore) FinishRun(runID string, status RunStatus, errMsg string) {
	s.stopHeartbeat(runID)

	ctx, cancel := redisContext(s.ctx, RedisOpTimeout)
	defer cancel()

	runJSON, err := s.client.Get(ctx, runKey(runID)).Result()
	if err != nil {
		s.logger.Error("Failed to get run from Redis for finish", "error", err, "runId", runID)
		return
	}

	var run AgentRun
	if err := json.Unmarshal([]byte(runJSON), &run); err != nil {
		s.logger.Error("Failed to unmarshal run", "error", err, "runId", runID)
		return
	}

	run.Status = status
	run.Error = errMsg
	run.UpdatedAt = time.Now()

	updatedJSON, err := json.Marshal(run)
	if err != nil {
		s.logger.Error("Failed to marshal updated run", "error", err, "runId", runID)
		return
	}

	ctx2, cancel2 := redisContext(s.ctx, RedisOpTimeout)
	defer cancel2()
	pipe := s.client.Pipeline()
	pipe.Set(ctx2, runKey(runID), updatedJSON, RunMaxAge)
	pipe.Del(ctx2, heartbeatKey(runID))
	pipe.Expire(ctx2, eventsKey(runID), RunMaxAge)
	pipe.ZAdd(ctx2, runIndexKey(run.UserID, run.OrgID), redis.Z{Score: float64(run.UpdatedAt.UnixNano()), Member: runID})
	pipe.Expire(ctx2, runIndexKey(run.UserID, run.OrgID), RunMaxAge)
	if _, err := pipe.Exec(ctx2); err != nil {
		s.logger.Warn("Failed to persist finished run metadata", "error", err, "runId", runID)
	}

	s.publish(runID, runStreamMessage{Kind: runStreamKindFinished})

	s.logger.Info("Agent run finished", "runId", runID, "status", status)
}

func (s *RedisRunStore) GetRun(runID string) (*AgentRun, error) {
	ctx, cancel := redisContext(s.ctx, RedisOpTimeout)
	defer cancel()

	runJSON, err := s.client.Get(ctx, runKey(runID)).Result()
	if err == redis.Nil {
		return nil, fmt.Errorf("run not found")
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get run from Redis: %w", err)
	}

	var run AgentRun
	if err := json.Unmarshal([]byte(runJSON), &run); err != nil {
		return nil, fmt.Errorf("failed to unmarshal run: %w", err)
	}

	s.reconcileStalledRun(&run)

	ctx2, cancel2 := redisContext(s.ctx, RedisBulkOpTimeout)
	defer cancel2()

	eventStrings, err := s.client.LRange(ctx2, eventsKey(runID), 0, -1).Result()
	if err != nil && err != redis.Nil {
		s.logger.Warn("Failed to load events from Redis", "error", err, "runId", runID)
		return &run, nil
	}

	run.Events = make([]agent.SSEEvent, 0, len(eventStrings))
	for _, es := range eventStrings {
		var event agent.SSEEvent
		if err := json.Unmarshal([]byte(es), &event); err != nil {
			s.logger.Warn("Failed to unmarshal event", "error", err, "runId", runID)
			continue
		}
		run.Events = append(run.Events, event)
	}

	return &run, nil
}

func (s *RedisRunStore) reconcileStalledRun(run *AgentRun) {
	if run.Status != RunStatusRunning {
		return
	}
	if time.Since(run.UpdatedAt) < RunHeartbeatTTL {
		return
	}

	ctx, cancel := redisContext(s.ctx, RedisOpTimeout)
	defer cancel()

	alive, err := s.client.Exists(ctx, heartbeatKey(run.RunID)).Result()
	if err != nil {
		s.logger.Warn("Failed to check run heartbeat", "error", err, "runId", run.RunID)
		return
	}
	if alive > 0 {
		return
	}

	claimed, err := s.client.SetNX(ctx, interruptedKey(run.RunID), "1", RunMaxAge).Result()
	if err != nil {
		s.logger.Warn("Failed to claim interrupted run", "error", err, "runId", run.RunID)
		return
	}
	if claimed {
		s.logger.Warn("Marking abandoned agent run as failed", "runId", run.RunID)
		errorEvent := agent.SSEEvent{Type: "error", Data: agent.ErrorEvent{Message: runInterruptedMessage}}
		s.AppendEvent(run.RunID, errorEvent)
		s.FinishRun(run.RunID, RunStatusFailed, runInterruptedMessage)
	}

	run.Status = RunStatusFailed
	run.Error = runInterruptedMessage
}

func (s *RedisRunStore) ListRuns(userID, orgID int64, limit int) ([]*AgentRun, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}

	ctx, cancel := redisContext(s.ctx, RedisBulkOpTimeout)
	defer cancel()

	ids, err := s.client.ZRevRange(ctx, runIndexKey(userID, orgID), 0, int64(limit-1)).Result()
	if err != nil && err != redis.Nil {
		return nil, fmt.Errorf("failed to list indexed runs: %w", err)
	}
	if len(ids) > 0 {
		runs := make([]*AgentRun, 0, len(ids))
		for _, runID := range ids {
			run, err := s.loadRunFromRedis(ctx, runID)
			if err != nil {
				s.client.ZRem(ctx, runIndexKey(userID, orgID), runID)
				continue
			}
			runs = append(runs, run)
		}
		if len(runs) > 0 {
			return runs, nil
		}
	}

	var (
		cursor uint64
		runs   []*AgentRun
	)

	for {
		keys, nextCursor, err := s.client.Scan(ctx, cursor, "run:*", 100).Result()
		if err != nil {
			return nil, fmt.Errorf("failed to scan runs: %w", err)
		}
		cursor = nextCursor

		for _, key := range keys {
			if strings.Count(key, ":") != 1 {
				continue
			}
			runJSON, err := s.client.Get(ctx, key).Result()
			if err == redis.Nil {
				continue
			}
			if err != nil {
				s.logger.Warn("Failed to load run during list", "error", err, "key", key)
				continue
			}

			var run AgentRun
			if err := json.Unmarshal([]byte(runJSON), &run); err != nil {
				s.logger.Warn("Failed to unmarshal run during list", "error", err, "key", key)
				continue
			}
			if run.UserID != userID || run.OrgID != orgID {
				continue
			}
			s.reconcileStalledRun(&run)
			runs = append(runs, copyRun(&run))
			s.client.ZAdd(ctx, runIndexKey(userID, orgID), redis.Z{Score: float64(run.UpdatedAt.UnixNano()), Member: run.RunID})
		}

		if cursor == 0 {
			break
		}
	}

	sort.Slice(runs, func(i, j int) bool {
		return runs[i].UpdatedAt.After(runs[j].UpdatedAt)
	})
	if len(runs) > limit {
		runs = runs[:limit]
	}
	s.client.Expire(ctx, runIndexKey(userID, orgID), RunMaxAge)
	return runs, nil
}

func (s *RedisRunStore) loadRunFromRedis(ctx context.Context, runID string) (*AgentRun, error) {
	runJSON, err := s.client.Get(ctx, runKey(runID)).Result()
	if err != nil {
		if err != redis.Nil {
			s.logger.Warn("Failed to load indexed run", "error", err, "runId", runID)
		}
		return nil, err
	}
	var run AgentRun
	if err := json.Unmarshal([]byte(runJSON), &run); err != nil {
		s.logger.Warn("Failed to unmarshal indexed run", "error", err, "runId", runID)
		return nil, err
	}
	s.reconcileStalledRun(&run)
	return copyRun(&run), nil
}

func (s *RedisRunStore) appendTraceEvent(runID string, event agent.SSEEvent) {
	ctx, cancel := redisContext(s.ctx, RedisOpTimeout)
	defer cancel()

	runJSON, err := s.client.Get(ctx, runKey(runID)).Result()
	if err != nil {
		s.logger.Warn("Failed to load run for trace update", "error", err, "runId", runID)
		return
	}

	var run AgentRun
	if err := json.Unmarshal([]byte(runJSON), &run); err != nil {
		s.logger.Warn("Failed to unmarshal run for trace update", "error", err, "runId", runID)
		return
	}

	applyTraceEvent(&run, event)
	run.UpdatedAt = time.Now()

	updatedJSON, err := json.Marshal(run)
	if err != nil {
		s.logger.Warn("Failed to marshal trace update", "error", err, "runId", runID)
		return
	}

	ctx2, cancel2 := redisContext(s.ctx, RedisOpTimeout)
	defer cancel2()
	pipe := s.client.Pipeline()
	pipe.Set(ctx2, runKey(runID), updatedJSON, RunMaxAge)
	pipe.ZAdd(ctx2, runIndexKey(run.UserID, run.OrgID), redis.Z{Score: float64(run.UpdatedAt.UnixNano()), Member: runID})
	pipe.Expire(ctx2, runIndexKey(run.UserID, run.OrgID), RunMaxAge)
	if _, err := pipe.Exec(ctx2); err != nil {
		s.logger.Warn("Failed to persist trace update", "error", err, "runId", runID)
	}
}

func (s *RedisRunStore) SubscribeAndSnapshot(runID string) (*AgentRun, <-chan agent.SSEEvent, func(), error) {
	sub, err := s.acquireSubscription(runID)
	if err != nil {
		s.logger.Warn("Failed to subscribe to run channel, serving snapshot only", "error", err, "runId", runID)
	}

	var ch <-chan agent.SSEEvent
	var unsub func()
	if sub != nil {
		ch, unsub = sub.broadcaster.Subscribe()
	}

	release := func() {
		if unsub != nil {
			unsub()
		}
		if sub != nil {
			s.releaseSubscription(runID, sub)
		}
	}

	run, err := s.GetRun(runID)
	if err != nil {
		release()
		return nil, nil, nil, err
	}

	if run.Status != RunStatusRunning || ch == nil {
		release()
		return run, nil, nil, nil
	}

	return run, ch, release, nil
}

func (s *RedisRunStore) acquireSubscription(runID string) (*runSubscription, error) {
	s.mu.Lock()
	if existing, ok := s.subscriptions[runID]; ok {
		existing.refs++
		s.mu.Unlock()
		return existing, nil
	}
	s.mu.Unlock()

	ctx, cancel := context.WithCancel(s.ctx)
	pubsub := s.client.Subscribe(ctx, runChannelKey(runID))
	confirmCtx, confirmCancel := redisContext(ctx, RedisOpTimeout)
	_, err := pubsub.Receive(confirmCtx)
	confirmCancel()
	if err != nil {
		cancel()
		pubsub.Close()
		return nil, fmt.Errorf("subscribe to run channel: %w", err)
	}

	s.mu.Lock()
	if existing, ok := s.subscriptions[runID]; ok {
		existing.refs++
		s.mu.Unlock()
		cancel()
		pubsub.Close()
		return existing, nil
	}
	sub := &runSubscription{
		broadcaster: newRunBroadcaster(),
		pubsub:      pubsub,
		cancel:      cancel,
		refs:        1,
	}
	s.subscriptions[runID] = sub
	s.mu.Unlock()

	go s.receiveRunEvents(ctx, runID, sub)
	return sub, nil
}

func (s *RedisRunStore) receiveRunEvents(ctx context.Context, runID string, sub *runSubscription) {
	defer s.retireSubscription(runID, sub)

	messages := sub.pubsub.Channel()
	statusCheck := time.NewTicker(RunStreamStatusCheckInterval)
	defer statusCheck.Stop()

	for {
		select {
		case msg, ok := <-messages:
			if !ok {
				return
			}
			var payload runStreamMessage
			if err := json.Unmarshal([]byte(msg.Payload), &payload); err != nil {
				s.logger.Warn("Failed to unmarshal run stream message", "error", err, "runId", runID)
				continue
			}
			if payload.Kind == runStreamKindFinished {
				return
			}
			if payload.Event != nil {
				sub.broadcaster.Broadcast(*payload.Event)
			}
		case <-statusCheck.C:
			if !s.runIsRunning(runID) {
				return
			}
		case <-ctx.Done():
			return
		}
	}
}

func (s *RedisRunStore) runIsRunning(runID string) bool {
	ctx, cancel := redisContext(s.ctx, RedisOpTimeout)
	defer cancel()

	run, err := s.loadRunFromRedis(ctx, runID)
	if err == redis.Nil {
		return false
	}
	if err != nil {
		return true
	}
	return run.Status == RunStatusRunning
}

func (s *RedisRunStore) releaseSubscription(runID string, sub *runSubscription) {
	s.mu.Lock()
	current, ok := s.subscriptions[runID]
	if !ok || current != sub {
		s.mu.Unlock()
		return
	}
	sub.refs--
	if sub.refs > 0 {
		s.mu.Unlock()
		return
	}
	delete(s.subscriptions, runID)
	s.mu.Unlock()

	s.closeSubscription(sub)
}

func (s *RedisRunStore) retireSubscription(runID string, sub *runSubscription) {
	s.mu.Lock()
	if current, ok := s.subscriptions[runID]; ok && current == sub {
		delete(s.subscriptions, runID)
	}
	s.mu.Unlock()

	s.closeSubscription(sub)
}

func (s *RedisRunStore) closeSubscription(sub *runSubscription) {
	sub.cancel()
	if err := sub.pubsub.Close(); err != nil {
		s.logger.Debug("Failed to close run pub/sub", "error", err)
	}
	sub.broadcaster.Close()
}

func (s *RedisRunStore) publish(runID string, msg runStreamMessage) {
	payload, err := json.Marshal(msg)
	if err != nil {
		s.logger.Error("Failed to marshal run stream message", "error", err, "runId", runID)
		return
	}

	ctx, cancel := redisContext(s.ctx, RedisOpTimeout)
	defer cancel()
	if err := s.client.Publish(ctx, runChannelKey(runID), payload).Err(); err != nil {
		s.logger.Warn("Failed to publish run stream message", "error", err, "runId", runID)
	}
}

func (s *RedisRunStore) CleanupOld() {}

func (s *RedisRunStore) touchRun(runID string) {
	ctx, cancel := redisContext(s.ctx, RedisOpTimeout)
	defer cancel()
	s.client.Expire(ctx, runKey(runID), RunMaxAge)
	s.client.Expire(ctx, eventsKey(runID), RunMaxAge)
	s.client.Expire(ctx, sequenceKey(runID), RunMaxAge)
}
