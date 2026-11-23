package plugin

import (
	"encoding/json"
	"fmt"
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

// workflowSessionStatus joins the in-memory last-tick state with durable
// session outcome counts derived from the run store, so the row counters and
// the sessions list always agree: both read the same run records of the
// requesting org. Both run stores clamp list limits above 100 down to 50, so
// 100 is the widest window either side can see; the panel fetches the same
// 100. Timed-out runs are stored as failed with a timeout message; they
// count as timeout.
func (p *Plugin) workflowSessionStatus(rawName string, orgID int64) workflowRuntimeStatus {
	name := strings.TrimSpace(rawName)
	status := p.workflowStatus.Get(name)
	if orgID <= 0 {
		return status
	}
	runs, err := p.runStore.ListRuns(syntheticWorkflowUserID(name), orgID, 100)
	if err != nil {
		// The durable counts are unavailable; the in-memory view still reports.
		return status
	}
	status.Started = 0
	status.Completed = 0
	status.Failed = 0
	status.Cancelled = 0
	status.Timeout = 0
	for _, run := range runs {
		status.Started++
		switch run.Status {
		case RunStatusCompleted:
			status.Completed++
		case RunStatusCancelled:
			status.Cancelled++
		case RunStatusFailed:
			if strings.Contains(run.Error, "timeout") {
				status.Timeout++
			} else {
				status.Failed++
			}
		}
	}
	return status
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
			Status:                p.workflowSessionStatus(entry.Name, getOrgID(r)),
		})
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(map[string]interface{}{"workflows": entries}); err != nil {
		p.logger.Error("Failed to encode workflows list", "error", err)
	}
}

// handleWorkflowRunShare serves POST /api/workflows/{name}/runs/{runId}/share:
// it gets or creates a read-only share link for one run's session and returns
// the share path. The share is owned by the workflow's synthetic user (the
// session owner), so creating it needs no cross-owner read. Admin only — the
// share grants unauthenticated read access to the session transcript.
func (p *Plugin) handleWorkflowRunShare(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !isAdmin(r) {
		http.Error(w, "Admin access required", http.StatusForbidden)
		return
	}
	name, ok := strings.CutPrefix(r.URL.Path, "/api/workflows/")
	withoutShare, hasShare := strings.CutSuffix(name, "/share")
	// Path shape: {workflow}/runs/{runId}. The workflow name cannot contain
	// "/runs/", so the first split is unambiguous.
	wfName, runAndID, hasRun := strings.Cut(withoutShare, "/runs/")
	runID := strings.TrimPrefix(runAndID, "/")
	if !hasRun {
		http.Error(w, "Invalid path format", http.StatusBadRequest)
		return
	}
	if !ok || !hasShare || wfName == "" || runID == "" {
		http.Error(w, "Invalid path format", http.StatusBadRequest)
		return
	}
	name = strings.TrimSpace(wfName)

	p.settingsMu.RLock()
	configured := p.settings.Workflows
	p.settingsMu.RUnlock()
	var found bool
	for _, entry := range configured {
		if strings.TrimSpace(entry.Name) == name {
			found = true
			break
		}
	}
	if !found {
		http.Error(w, "Workflow not found", http.StatusNotFound)
		return
	}

	orgID := getOrgID(r)
	synthetic := syntheticWorkflowUserID(name)
	run, err := p.runStore.GetRun(runID)
	if err != nil || run == nil || run.SessionID == "" || run.UserID != synthetic || run.OrgID != orgID {
		http.Error(w, "Run not found", http.StatusNotFound)
		return
	}

	// Reuse the newest unexpired share for this session when one exists.
	for _, share := range p.shareStore.GetSharesBySession(run.SessionID) {
		if share.ExpiresAt == nil || share.ExpiresAt.After(time.Now().UTC()) {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]string{
				"shareId":  share.ShareID,
				"shareUrl": fmt.Sprintf("/a/%s/shared/%s?orgId=%d", PluginID, share.ShareID, orgID),
			})
			return
		}
	}

	// The synthetic user owns the session, so the owner-scoped read works.
	session, err := p.sessionStore.GetSession(run.SessionID, synthetic, orgID)
	if err != nil {
		http.Error(w, "Session not found", http.StatusNotFound)
		return
	}
	data, err := json.Marshal(session)
	if err != nil {
		p.logger.Error("Failed to encode workflow session for share", "error", err)
		http.Error(w, "Failed to create share", http.StatusInternalServerError)
		return
	}
	if err := ValidateSessionData(data); err != nil {
		http.Error(w, "Failed to create share", http.StatusInternalServerError)
		return
	}
	hours := 30 * 24
	share, err := p.shareStore.CreateShare(run.SessionID, data, orgID, synthetic, &hours)
	if err != nil {
		p.logger.Error("Failed to create workflow session share", "error", err)
		http.Error(w, "Failed to create share", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"shareId":  share.ShareID,
		"shareUrl": fmt.Sprintf("/a/%s/shared/%s?orgId=%d", PluginID, share.ShareID, orgID),
	})
}

// handleWorkflowRuns serves GET /api/workflows/{name}/runs: the recent runs
// of one workflow, newest first, owned by the workflow's synthetic user. The
// chat deep link (?sessionId=) opens each run's session; the session GET
// allows Admins to read workflow sessions. Admin only.
func (p *Plugin) handleWorkflowRuns(w http.ResponseWriter, r *http.Request) {
	// /api/workflows/{name}/runs/{runId}/share → get-or-create a share link.
	if strings.HasSuffix(r.URL.Path, "/share") {
		p.handleWorkflowRunShare(w, r)
		return
	}
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
	// prepareWorkflows trims entry names before schedulers start, so session
	// owners are keyed by the trimmed name; trim here to match.
	name = strings.TrimSpace(runIDPart)

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
