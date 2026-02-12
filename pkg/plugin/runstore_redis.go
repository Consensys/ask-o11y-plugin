package plugin

import (
	"consensys-asko11y-app/pkg/agent"
	"encoding/json"
	"fmt"
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
}

func NewRedisRunStore(client *redis.Client, logger log.Logger) *RedisRunStore {
	return &RedisRunStore{
		client:       client,
		logger:       logger,
		broadcasters: make(map[string]*RunBroadcaster),
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
	}

	runJSON, err := json.Marshal(run)
	if err != nil {
		s.logger.Error("Failed to marshal run", "error", err, "runId", runID)
		return run
	}

	key := fmt.Sprintf("run:%s", runID)
	ctx, cancel := getContextWithTimeout(RedisOpTimeout)
	defer cancel()
	if err := s.client.Set(ctx, key, runJSON, RunMaxAge).Err(); err != nil {
		s.logger.Error("Failed to store run in Redis", "error", err, "runId", runID)
	}

	s.mu.Lock()
	s.broadcasters[runID] = newRunBroadcaster()
	s.mu.Unlock()

	return run
}

func (s *RedisRunStore) AppendEvent(runID string, event agent.SSEEvent) {
	eventJSON, err := json.Marshal(event)
	if err != nil {
		s.logger.Error("Failed to marshal event", "error", err, "runId", runID)
		return
	}

	eventsKey := fmt.Sprintf("run:%s:events", runID)
	pushCtx, pushCancel := getContextWithTimeout(RedisOpTimeout)
	defer pushCancel()

	listLen, err := s.client.RPush(pushCtx, eventsKey, eventJSON).Result()
	if err != nil {
		s.logger.Error("Failed to append event to Redis", "error", err, "runId", runID)
		return
	}

	if listLen == 1 {
		ctx, cancel := getContextWithTimeout(RedisOpTimeout)
		defer cancel()
		s.client.Expire(ctx, eventsKey, RunMaxAge)
	} else if listLen > int64(RunMaxEventsPerRun) {
		ctx, cancel := getContextWithTimeout(RedisOpTimeout)
		defer cancel()
		s.client.LTrim(ctx, eventsKey, -int64(RunMaxEventsPerRun), -1)
	}

	s.touchRun(runID)

	s.mu.RLock()
	b := s.broadcasters[runID]
	s.mu.RUnlock()
	if b != nil {
		b.Broadcast(event)
	}
}

func (s *RedisRunStore) FinishRun(runID string, status RunStatus, errMsg string) {
	key := fmt.Sprintf("run:%s", runID)
	ctx, cancel := getContextWithTimeout(RedisOpTimeout)
	defer cancel()

	runJSON, err := s.client.Get(ctx, key).Result()
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

	ctx2, cancel2 := getContextWithTimeout(RedisOpTimeout)
	defer cancel2()
	s.client.Set(ctx2, key, updatedJSON, RunMaxAge)

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
	key := fmt.Sprintf("run:%s", runID)
	ctx, cancel := getContextWithTimeout(RedisOpTimeout)
	defer cancel()

	runJSON, err := s.client.Get(ctx, key).Result()
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

	eventsKey := fmt.Sprintf("run:%s:events", runID)
	ctx2, cancel2 := getContextWithTimeout(RedisBulkOpTimeout)
	defer cancel2()

	eventStrings, err := s.client.LRange(ctx2, eventsKey, 0, -1).Result()
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

func (s *RedisRunStore) GetBroadcaster(runID string) *RunBroadcaster {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.broadcasters[runID]
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
	key := fmt.Sprintf("run:%s", runID)
	ctx, cancel := getContextWithTimeout(RedisOpTimeout)
	defer cancel()

	runJSON, err := s.client.Get(ctx, key).Result()
	if err != nil {
		return
	}

	var run AgentRun
	if err := json.Unmarshal([]byte(runJSON), &run); err != nil {
		return
	}

	run.UpdatedAt = time.Now()

	updatedJSON, err := json.Marshal(run)
	if err != nil {
		return
	}

	ctx2, cancel2 := getContextWithTimeout(RedisOpTimeout)
	defer cancel2()
	s.client.Set(ctx2, key, updatedJSON, RunMaxAge)
}
