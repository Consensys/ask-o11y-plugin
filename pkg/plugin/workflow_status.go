package plugin

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

// workflowRuntimeStatus is one workflow's view on this plugin instance:
// when its scheduler last ticked and how its sessions ended. The counters
// are per instance, not cluster-wide; the API consumer surfaces that.
type workflowRuntimeStatus struct {
	LastTickAt      *time.Time `json:"lastTickAt,omitempty"`
	LastTickOutcome string     `json:"lastTickOutcome,omitempty"`
	Started         int64      `json:"started"`
	Completed       int64      `json:"completed"`
	Failed          int64      `json:"failed"`
	Cancelled       int64      `json:"cancelled"`
	Timeout         int64      `json:"timeout"`
	LastError       string     `json:"lastError,omitempty"`
}

// WorkflowStatusStore tracks per-workflow runtime state in memory. The
// Prometheus metrics remain the aggregated source of truth; this store gives
// the config UI a cheap per-entry snapshot without scraping.
type WorkflowStatusStore struct {
	mu      sync.RWMutex
	entries map[string]*workflowRuntimeStatus
}

func NewWorkflowStatusStore() *WorkflowStatusStore {
	return &WorkflowStatusStore{entries: map[string]*workflowRuntimeStatus{}}
}

func (s *WorkflowStatusStore) entry(name string) *workflowRuntimeStatus {
	if s == nil {
		return &workflowRuntimeStatus{}
	}
	e, ok := s.entries[name]
	if !ok {
		e = &workflowRuntimeStatus{}
		s.entries[name] = e
	}
	return e
}

// RecordTick notes one scheduler tick outcome for a workflow. A tick that
// proceeds clears the previous tick error, so a recovered workflow no longer
// looks like it is failing.
func (s *WorkflowStatusStore) RecordTick(name, outcome string) {
	now := time.Now().UTC()
	if s == nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	e := s.entry(name)
	e.LastTickAt = &now
	e.LastTickOutcome = outcome
	e.LastError = ""
}

// RecordTickError notes a tick that could not proceed and why.
func (s *WorkflowStatusStore) RecordTickError(name string, errMsg string) {
	now := time.Now().UTC()
	if s == nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	e := s.entry(name)
	e.LastTickAt = &now
	e.LastTickOutcome = "skip_error"
	e.LastError = errMsg
}

// RecordSessionError records a session-level failure message without
// changing the tick outcome: a tick that ran but could not start its session
// still executed.
func (s *WorkflowStatusStore) RecordSessionError(name string, errMsg string) {
	if s == nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.entry(name).LastError = errMsg
}

// RecordSession counts one session outcome.
func (s *WorkflowStatusStore) RecordSession(name, outcome string) {
	if s == nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	e := s.entry(name)
	switch outcome {
	case "started":
		e.Started++
	case "completed":
		e.Completed++
	case "failed":
		e.Failed++
	case "cancelled":
		e.Cancelled++
	case "timeout":
		e.Timeout++
	}
}

// Get returns a copy of one workflow's status; the zero value when the
// workflow never ticked on this instance.
func (s *WorkflowStatusStore) Get(name string) workflowRuntimeStatus {
	if s == nil {
		return workflowRuntimeStatus{}
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	if e, ok := s.entries[name]; ok {
		return *e
	}
	return workflowRuntimeStatus{}
}

// workflowAPIEntry is one row of the GET /api/workflows response: the
// configured entry joined with this instance's runtime status.
type workflowAPIEntry struct {
	Name                  string   `json:"name"`
	Enabled               bool     `json:"enabled"`
	Skill                 string   `json:"skill"`
	Message               string   `json:"message,omitempty"`
	Model                 string   `json:"model,omitempty"`
	IntervalSeconds       int      `json:"intervalSeconds"`
	SessionTimeoutSeconds int      `json:"sessionTimeoutSeconds"`
	MaxConcurrentSessions int      `json:"maxConcurrentSessions"`
	MaxIterations         int      `json:"maxIterations,omitempty"`
	ToolAllowlist         []string `json:"toolAllowlist"`
	SpawnableSkills       []string `json:"spawnableSkills,omitempty"`
	FallbackSkill         string   `json:"fallbackSkill,omitempty"`
	// Running reports whether a scheduler for this entry exists on this
	// plugin instance. Disabled and invalid entries never run.
	Running bool                  `json:"running"`
	Status  workflowRuntimeStatus `json:"status"`
}

// handleWorkflowsList serves GET /api/workflows: every configured workflow
// entry with this instance's runtime status. Admin only, like the rest of
// the AppConfig data routes.
func (p *Plugin) handleWorkflowsList(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !isAdmin(r) {
		http.Error(w, "Admin access required", http.StatusForbidden)
		return
	}

	p.settingsMu.RLock()
	configured := p.settings.Workflows
	p.settingsMu.RUnlock()

	running := map[string]bool{}
	if p.workflows != nil {
		for _, s := range p.workflows.schedulers {
			// A scheduler that stopped itself (deferred validation failure)
			// stays in the manager; report it as not running.
			running[s.entry.Name] = !s.Stopped()
		}
	}

	entries := make([]workflowAPIEntry, 0, len(configured))
	for _, raw := range configured {
		// Resolve defaults on a copy: disabled or never-validated entries can
		// carry zero intervals in raw settings, and the tab must not render
		// 0s or persist zeros back through a toggle.
		entry := raw
		entry.applyDefaults()
		entries = append(entries, workflowAPIEntry{
			Name:                  entry.Name,
			Enabled:               entry.Enabled,
			Skill:                 entry.Skill,
			Message:               entry.Message,
			Model:                 entry.Model,
			IntervalSeconds:       entry.IntervalSec,
			SessionTimeoutSeconds: entry.SessionTimeoutSeconds,
			MaxConcurrentSessions: entry.MaxConcurrentSessions,
			MaxIterations:         entry.MaxIterations,
			ToolAllowlist:         entry.ToolAllowlist,
			SpawnableSkills:       entry.SpawnableSkills,
			FallbackSkill:         entry.FallbackSkill,
			Running:               running[entry.Name],
			Status:                p.workflowStatus.Get(entry.Name),
		})
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(map[string]interface{}{"workflows": entries}); err != nil {
		p.logger.Error("Failed to encode workflows list", "error", err)
	}
}

// handleWorkflowRuns serves GET /api/workflows/{name}/runs: the recent runs
// of one workflow, newest first, owned by the workflow's synthetic user. The
// chat deep link (?sessionId=) opens each run's session; the session GET
// allows Admins to read workflow sessions. Admin only.
func (p *Plugin) handleWorkflowRuns(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !isAdmin(r) {
		http.Error(w, "Admin access required", http.StatusForbidden)
		return
	}
	name, ok := strings.CutPrefix(r.URL.Path, "/api/workflows/")
	runIDPart, hasRuns := strings.CutSuffix(name, "/runs")
	if !ok || !hasRuns || runIDPart == "" {
		http.Error(w, "Invalid path format", http.StatusBadRequest)
		return
	}
	name = runIDPart

	p.settingsMu.RLock()
	configured := p.settings.Workflows
	p.settingsMu.RUnlock()
	var entry *WorkflowEntry
	for i := range configured {
		if configured[i].Name == name {
			entry = &configured[i]
			break
		}
	}
	if entry == nil {
		http.Error(w, "Workflow not found", http.StatusNotFound)
		return
	}

	limit := 20
	if raw := r.URL.Query().Get("limit"); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 && parsed <= 100 {
			limit = parsed
		}
	}

	orgID := getOrgID(r)
	runs, err := p.runStore.ListRuns(syntheticWorkflowUserID(name), orgID, limit)
	if err != nil {
		p.logger.Error("Failed to list workflow runs", "workflow", name, "error", err)
		http.Error(w, "Failed to list runs", http.StatusInternalServerError)
		return
	}

	type workflowRun struct {
		RunID     string    `json:"runId"`
		SessionID string    `json:"sessionId,omitempty"`
		Status    RunStatus `json:"status"`
		Skill     string    `json:"skill,omitempty"`
		CreatedAt time.Time `json:"createdAt"`
		UpdatedAt time.Time `json:"updatedAt"`
		Error     string    `json:"error,omitempty"`
	}
	out := make([]workflowRun, 0, len(runs))
	for _, run := range runs {
		out = append(out, workflowRun{
			RunID:     run.RunID,
			SessionID: run.SessionID,
			Status:    run.Status,
			Skill:     entry.Skill,
			CreatedAt: run.CreatedAt,
			UpdatedAt: run.UpdatedAt,
			Error:     run.Error,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(map[string]interface{}{"workflow": name, "runs": out}); err != nil {
		p.logger.Error("Failed to encode workflow runs", "workflow", name, "error", err)
	}
}
