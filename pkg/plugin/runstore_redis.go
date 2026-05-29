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
	client       *redis.Client
	logger       log.Logger
	mu           sync.RWMutex
	broadcasters map[string]*RunBroadcaster
	ctx          context.Context
}

func runKey(runID string) string      { return fmt.Sprintf("run:%s", runID) }
func eventsKey(runID string) string   { return fmt.Sprintf("run:%s:events", runID) }
func sequenceKey(runID string) string { return fmt.Sprintf("run:%s:sequence", runID) }
func runIndexKey(userID, orgID int64) string {
	return fmt.Sprintf("runs:user:%d:org:%d", userID, orgID)
}

func NewRedisRunStore(ctx context.Context, client *redis.Client, logger log.Logger) *RedisRunStore {
	return &RedisRunStore{
		client:       client,
		logger:       logger,
		broadcasters: make(map[string]*RunBroadcaster),
		ctx:          ctx,
	}
}

func (s *RedisRunStore) CreateRun(runID string, userID, orgID int64) *AgentRun {
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

	runJSON, err := json.Marshal(run)
	if err != nil {
		s.logger.Error("Failed to marshal run", "error", err, "runId", runID)
		return run
	}

	ctx, cancel := redisContext(s.ctx, RedisOpTimeout)
	defer cancel()
	pipe := s.client.Pipeline()
	pipe.Set(ctx, runKey(runID), runJSON, RunMaxAge)
	pipe.ZAdd(ctx, runIndexKey(userID, orgID), redis.Z{Score: float64(now.UnixNano()), Member: runID})
	pipe.Expire(ctx, runIndexKey(userID, orgID), RunMaxAge)
	if _, err := pipe.Exec(ctx); err != nil {
		s.logger.Error("Failed to store run in Redis", "error", err, "runId", runID)
	}

	s.mu.Lock()
	s.broadcasters[runID] = newRunBroadcaster()
	s.mu.Unlock()

	return run
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

	s.mu.RLock()
	b := s.broadcasters[runID]
	s.mu.RUnlock()
	if b != nil {
		b.Broadcast(event)
	}
}

func (s *RedisRunStore) FinishRun(runID string, status RunStatus, errMsg string) {
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
	pipe.Expire(ctx2, eventsKey(runID), RunMaxAge)
	pipe.ZAdd(ctx2, runIndexKey(run.UserID, run.OrgID), redis.Z{Score: float64(run.UpdatedAt.UnixNano()), Member: runID})
	pipe.Expire(ctx2, runIndexKey(run.UserID, run.OrgID), RunMaxAge)
	if _, err := pipe.Exec(ctx2); err != nil {
		s.logger.Warn("Failed to persist finished run metadata", "error", err, "runId", runID)
	}

	s.mu.Lock()
	b := s.broadcasters[runID]
	if b != nil {
		b.Close()
		delete(s.broadcasters, runID)
	}
	s.mu.Unlock()

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
			run, ok := s.loadRunFromRedis(ctx, runID)
			if !ok {
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
			if strings.Contains(key, ":events") || strings.Contains(key, ":sequence") {
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

func (s *RedisRunStore) loadRunFromRedis(ctx context.Context, runID string) (*AgentRun, bool) {
	runJSON, err := s.client.Get(ctx, runKey(runID)).Result()
	if err == redis.Nil {
		return nil, false
	}
	if err != nil {
		s.logger.Warn("Failed to load indexed run", "error", err, "runId", runID)
		return nil, false
	}
	var run AgentRun
	if err := json.Unmarshal([]byte(runJSON), &run); err != nil {
		s.logger.Warn("Failed to unmarshal indexed run", "error", err, "runId", runID)
		return nil, false
	}
	return copyRun(&run), true
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

func (s *RedisRunStore) GetBroadcaster(runID string) *RunBroadcaster {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.broadcasters[runID]
}

func (s *RedisRunStore) SubscribeAndSnapshot(runID string) (*AgentRun, <-chan agent.SSEEvent, func(), error) {
	s.mu.RLock()
	b := s.broadcasters[runID]
	s.mu.RUnlock()

	var ch <-chan agent.SSEEvent
	var unsub func()
	if b != nil {
		ch, unsub = b.Subscribe()
	}

	run, err := s.GetRun(runID)
	if err != nil {
		if unsub != nil {
			unsub()
		}
		return nil, nil, nil, err
	}

	if run.Status != RunStatusRunning {
		if unsub != nil {
			unsub()
		}
		return run, nil, nil, nil
	}

	return run, ch, unsub, nil
}

func (s *RedisRunStore) CleanupOld() {
	s.mu.Lock()
	defer s.mu.Unlock()

	for runID, b := range s.broadcasters {
		if b.IsClosed() {
			delete(s.broadcasters, runID)
		}
	}
}

func (s *RedisRunStore) touchRun(runID string) {
	ctx, cancel := redisContext(s.ctx, RedisOpTimeout)
	defer cancel()
	s.client.Expire(ctx, runKey(runID), RunMaxAge)
	s.client.Expire(ctx, eventsKey(runID), RunMaxAge)
	s.client.Expire(ctx, sequenceKey(runID), RunMaxAge)
}
