package plugin

import (
	"consensys-asko11y-app/pkg/agent"
	"encoding/json"
	"fmt"
	"sort"
	"sync"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
)

type RunStatus string

const (
	RunStatusRunning   RunStatus = "running"
	RunStatusCompleted RunStatus = "completed"
	RunStatusFailed    RunStatus = "failed"
	RunStatusCancelled RunStatus = "cancelled"
)

type AgentRun struct {
	RunID        string           `json:"runId"`
	SessionID    string           `json:"sessionId,omitempty"`
	Status       RunStatus        `json:"status"`
	UserID       int64            `json:"userId"`
	OrgID        int64            `json:"orgId"`
	CreatedAt    time.Time        `json:"createdAt"`
	UpdatedAt    time.Time        `json:"updatedAt"`
	Events       []agent.SSEEvent `json:"events"`
	Trace        *AgentRunTrace   `json:"trace,omitempty"`
	Error        string           `json:"error,omitempty"`
	NextSequence int64            `json:"-"`
}

type AgentRunTrace struct {
	Plan        []agent.PlanStep        `json:"plan,omitempty"`
	Evidence    []agent.EvidenceEvent   `json:"evidence,omitempty"`
	Approvals   []RunApproval           `json:"approvals,omitempty"`
	FinalReport *agent.FinalReportEvent `json:"finalReport,omitempty"`
}

type RunApproval struct {
	ApprovalID string     `json:"approvalId"`
	ToolCallID string     `json:"toolCallId,omitempty"`
	ToolName   string     `json:"toolName,omitempty"`
	Risk       string     `json:"risk,omitempty"`
	Reason     string     `json:"reason,omitempty"`
	Arguments  string     `json:"arguments,omitempty"`
	Decision   string     `json:"decision,omitempty"`
	Comment    string     `json:"comment,omitempty"`
	CreatedAt  time.Time  `json:"createdAt"`
	ResolvedAt *time.Time `json:"resolvedAt,omitempty"`
}

type RunStoreInterface interface {
	CreateRun(runID string, userID, orgID int64, sessionID ...string) *AgentRun
	AppendEvent(runID string, event agent.SSEEvent)
	FinishRun(runID string, status RunStatus, errMsg string)
	GetRun(runID string) (*AgentRun, error)
	ListRuns(userID, orgID int64, limit int) ([]*AgentRun, error)
	GetBroadcaster(runID string) *RunBroadcaster
	SubscribeAndSnapshot(runID string) (*AgentRun, <-chan agent.SSEEvent, func(), error)
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
		if b.closed {
			return
		}
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

func (s *RunStore) CreateRun(runID string, userID, orgID int64, sessionID ...string) *AgentRun {
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
		Trace:     &AgentRunTrace{},
	}
	if len(sessionID) > 0 {
		run.SessionID = sessionID[0]
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
	event.Sequence = run.NextSequence
	run.NextSequence++
	run.Events = append(run.Events, event)
	if len(run.Events) > RunMaxEventsPerRun {
		run.Events = run.Events[len(run.Events)-RunMaxEventsPerRun:]
	}
	applyTraceEvent(run, event)
	run.UpdatedAt = time.Now()
	b := s.broadcasters[runID]
	s.mu.Unlock()

	if b != nil && !b.IsClosed() {
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

	return copyRun(run), nil
}

func (s *RunStore) ListRuns(userID, orgID int64, limit int) ([]*AgentRun, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}

	s.mu.RLock()
	defer s.mu.RUnlock()

	runs := make([]*AgentRun, 0, min(limit, len(s.runs)))
	for _, run := range s.runs {
		if run.UserID != userID || run.OrgID != orgID {
			continue
		}
		runs = append(runs, copyRun(run))
	}

	sort.Slice(runs, func(i, j int) bool {
		return runs[i].UpdatedAt.After(runs[j].UpdatedAt)
	})
	if len(runs) > limit {
		runs = runs[:limit]
	}
	return runs, nil
}

func (s *RunStore) GetBroadcaster(runID string) *RunBroadcaster {
	s.mu.RLock()
	defer s.mu.RUnlock()

	return s.broadcasters[runID]
}

// SubscribeAndSnapshot atomically subscribes and snapshots under one lock
// to avoid the duplicate-event window of separate Subscribe + GetRun calls.
func (s *RunStore) SubscribeAndSnapshot(runID string) (*AgentRun, <-chan agent.SSEEvent, func(), error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	run, exists := s.runs[runID]
	if !exists {
		return nil, nil, nil, fmt.Errorf("run not found")
	}

	copied := copyRun(run)

	b := s.broadcasters[runID]
	if b == nil || run.Status != RunStatusRunning {
		return copied, nil, nil, nil
	}

	ch, unsub := b.Subscribe()
	return copied, ch, unsub, nil
}

func copyRun(run *AgentRun) *AgentRun {
	if run == nil {
		return nil
	}
	copied := *run
	copied.Events = make([]agent.SSEEvent, len(run.Events))
	copy(copied.Events, run.Events)
	copied.Trace = copyTrace(run.Trace)
	return &copied
}

func applyTraceEvent(run *AgentRun, event agent.SSEEvent) {
	if run.Trace == nil {
		run.Trace = &AgentRunTrace{}
	}
	switch event.Type {
	case "run_plan":
		if data, ok := decodeEventData[agent.RunPlanEvent](event.Data); ok {
			run.Trace.Plan = append([]agent.PlanStep(nil), data.Steps...)
		}
	case "step_start", "step_done":
		if data, ok := decodeEventData[agent.StepEvent](event.Data); ok {
			updateTraceStep(run.Trace, data)
		}
	case "evidence":
		if data, ok := decodeEventData[agent.EvidenceEvent](event.Data); ok {
			upsertEvidence(run.Trace, data)
		}
	case "approval_request":
		if data, ok := decodeEventData[agent.ApprovalRequestEvent](event.Data); ok {
			upsertApproval(run.Trace, RunApproval{
				ApprovalID: data.ApprovalID,
				ToolCallID: data.ToolCallID,
				ToolName:   data.ToolName,
				Risk:       data.Risk,
				Reason:     data.Reason,
				Arguments:  data.Arguments,
				CreatedAt:  time.Now().UTC(),
			})
		}
	case "approval_resolved":
		if data, ok := decodeEventData[agent.ApprovalResolvedEvent](event.Data); ok {
			resolveTraceApproval(run.Trace, data)
		}
	case "final_report":
		if data, ok := decodeEventData[agent.FinalReportEvent](event.Data); ok {
			report := data
			run.Trace.FinalReport = &report
		}
	}
}

func decodeEventData[T any](data interface{}) (T, bool) {
	if typed, ok := data.(T); ok {
		return typed, true
	}
	var out T
	raw, err := json.Marshal(data)
	if err != nil {
		return out, false
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return out, false
	}
	return out, true
}

func updateTraceStep(trace *AgentRunTrace, event agent.StepEvent) {
	for i := range trace.Plan {
		if trace.Plan[i].ID == event.ID {
			trace.Plan[i].Status = event.Status
			return
		}
	}
	if event.ID != "" {
		trace.Plan = append(trace.Plan, agent.PlanStep{
			ID:     event.ID,
			Title:  event.Title,
			Status: event.Status,
		})
	}
}

func upsertEvidence(trace *AgentRunTrace, evidence agent.EvidenceEvent) {
	for i := range trace.Evidence {
		if trace.Evidence[i].ID == evidence.ID {
			trace.Evidence[i] = evidence
			return
		}
	}
	trace.Evidence = append(trace.Evidence, evidence)
}

func upsertApproval(trace *AgentRunTrace, approval RunApproval) {
	for i := range trace.Approvals {
		if trace.Approvals[i].ApprovalID == approval.ApprovalID {
			if trace.Approvals[i].Decision != "" {
				approval.Decision = trace.Approvals[i].Decision
				approval.Comment = trace.Approvals[i].Comment
				approval.ResolvedAt = trace.Approvals[i].ResolvedAt
			}
			trace.Approvals[i] = approval
			return
		}
	}
	trace.Approvals = append(trace.Approvals, approval)
}

func resolveTraceApproval(trace *AgentRunTrace, resolved agent.ApprovalResolvedEvent) {
	resolvedAt := time.Now().UTC()
	if resolved.ResolvedAt != "" {
		if parsed, err := time.Parse(time.RFC3339, resolved.ResolvedAt); err == nil {
			resolvedAt = parsed
		}
	}
	for i := range trace.Approvals {
		if trace.Approvals[i].ApprovalID == resolved.ApprovalID {
			trace.Approvals[i].Decision = resolved.Decision
			trace.Approvals[i].Comment = resolved.Comment
			trace.Approvals[i].ResolvedAt = &resolvedAt
			return
		}
	}
	trace.Approvals = append(trace.Approvals, RunApproval{
		ApprovalID: resolved.ApprovalID,
		Decision:   resolved.Decision,
		Comment:    resolved.Comment,
		CreatedAt:  resolvedAt,
		ResolvedAt: &resolvedAt,
	})
}

func copyTrace(trace *AgentRunTrace) *AgentRunTrace {
	if trace == nil {
		return nil
	}
	copied := *trace
	copied.Plan = append([]agent.PlanStep(nil), trace.Plan...)
	copied.Evidence = append([]agent.EvidenceEvent(nil), trace.Evidence...)
	copied.Approvals = append([]RunApproval(nil), trace.Approvals...)
	if trace.FinalReport != nil {
		report := *trace.FinalReport
		report.EvidenceIDs = append([]string(nil), trace.FinalReport.EvidenceIDs...)
		report.Gaps = append([]string(nil), trace.FinalReport.Gaps...)
		report.NextSteps = append([]string(nil), trace.FinalReport.NextSteps...)
		copied.FinalReport = &report
	}
	return &copied
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
