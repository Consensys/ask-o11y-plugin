package plugin

import (
	"consensys-asko11y-app/pkg/agent"
	"fmt"
	"sync"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
)

type RunStatus string

const (
	RunStatusRunning   RunStatus = "running"
	RunStatusCompleted RunStatus = "completed"
	RunStatusFailed    RunStatus = "failed"
)

type AgentRun struct {
	RunID     string           `json:"runId"`
	Status    RunStatus        `json:"status"`
	UserID    int64            `json:"userId"`
	OrgID     int64            `json:"orgId"`
	CreatedAt time.Time        `json:"createdAt"`
	UpdatedAt time.Time        `json:"updatedAt"`
	Events    []agent.SSEEvent `json:"events"`
	Error     string           `json:"error,omitempty"`
}

type RunStoreInterface interface {
	CreateRun(runID string, userID, orgID int64) *AgentRun
	AppendEvent(runID string, event agent.SSEEvent)
	FinishRun(runID string, status RunStatus, errMsg string)
	GetRun(runID string) (*AgentRun, error)
	GetBroadcaster(runID string) *RunBroadcaster
	CleanupOld()
}

type RunBroadcaster struct {
	mu          sync.Mutex
	subscribers []chan agent.SSEEvent
	closed      bool
}

func newRunBroadcaster() *RunBroadcaster {
	return &RunBroadcaster{}
}

func (b *RunBroadcaster) Subscribe() (<-chan agent.SSEEvent, func()) {
	b.mu.Lock()
	defer b.mu.Unlock()

	if b.closed {
		ch := make(chan agent.SSEEvent)
		close(ch)
		return ch, func() {}
	}

	ch := make(chan agent.SSEEvent, 64)
	b.subscribers = append(b.subscribers, ch)

	unsubscribe := func() {
		b.mu.Lock()
		defer b.mu.Unlock()
		for i, sub := range b.subscribers {
			if sub == ch {
				b.subscribers = append(b.subscribers[:i], b.subscribers[i+1:]...)
				close(ch)
				return
			}
		}
	}

	return ch, unsubscribe
}

func (b *RunBroadcaster) Broadcast(event agent.SSEEvent) {
	b.mu.Lock()
	defer b.mu.Unlock()

	for _, ch := range b.subscribers {
		select {
		case ch <- event:
		default:
		}
	}
}

func (b *RunBroadcaster) Close() {
	b.mu.Lock()
	defer b.mu.Unlock()

	b.closed = true
	for _, ch := range b.subscribers {
		close(ch)
	}
	b.subscribers = nil
}

func (b *RunBroadcaster) IsClosed() bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.closed
}

type RunStore struct {
	mu           sync.RWMutex
	runs         map[string]*AgentRun
	broadcasters map[string]*RunBroadcaster
	logger       log.Logger
}

func NewRunStore(logger log.Logger) *RunStore {
	return &RunStore{
		runs:         make(map[string]*AgentRun),
		broadcasters: make(map[string]*RunBroadcaster),
		logger:       logger,
	}
}

func (s *RunStore) CreateRun(runID string, userID, orgID int64) *AgentRun {
	s.mu.Lock()
	defer s.mu.Unlock()

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

	s.runs[runID] = run
	s.broadcasters[runID] = newRunBroadcaster()
	return run
}

func (s *RunStore) AppendEvent(runID string, event agent.SSEEvent) {
	s.mu.Lock()
	run, exists := s.runs[runID]
	if !exists {
		s.mu.Unlock()
		return
	}
	if len(run.Events) < RunMaxEventsPerRun {
		run.Events = append(run.Events, event)
	}
	run.UpdatedAt = time.Now()
	b := s.broadcasters[runID]
	s.mu.Unlock()

	if b != nil {
		b.Broadcast(event)
	}
}

func (s *RunStore) FinishRun(runID string, status RunStatus, errMsg string) {
	s.mu.Lock()
	run, exists := s.runs[runID]
	if !exists {
		s.mu.Unlock()
		return
	}
	run.Status = status
	run.Error = errMsg
	run.UpdatedAt = time.Now()
	b := s.broadcasters[runID]
	s.mu.Unlock()

	if b != nil {
		b.Close()
	}

	s.logger.Info("Agent run finished", "runId", runID, "status", status)
}

func (s *RunStore) GetRun(runID string) (*AgentRun, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	run, exists := s.runs[runID]
	if !exists {
		return nil, fmt.Errorf("run not found")
	}

	copied := *run
	copied.Events = make([]agent.SSEEvent, len(run.Events))
	copy(copied.Events, run.Events)
	return &copied, nil
}

func (s *RunStore) GetBroadcaster(runID string) *RunBroadcaster {
	s.mu.RLock()
	defer s.mu.RUnlock()

	return s.broadcasters[runID]
}

func (s *RunStore) CleanupOld() {
	s.mu.Lock()
	defer s.mu.Unlock()

	cutoff := time.Now().Add(-RunMaxAge)
	var count int

	for runID, run := range s.runs {
		if run.Status == RunStatusRunning || run.UpdatedAt.After(cutoff) {
			continue
		}
		if b, ok := s.broadcasters[runID]; ok {
			b.Close()
		}
		delete(s.broadcasters, runID)
		delete(s.runs, runID)
		count++
	}

	if count > 0 {
		s.logger.Info("Cleaned up old agent runs", "count", count)
	}
}
