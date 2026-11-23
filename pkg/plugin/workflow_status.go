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
	runs, err := p.runStore.ListRuns(syntheticWorkflowUserID(name, orgID), orgID, 100)
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

// handleWorkflows serves /api/workflows: GET lists this org's entries, PUT
// replaces them. Both operations are admin-only, like the rest of the
// AppConfig data routes.
func (p *Plugin) handleWorkflows(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		p.handleWorkflowsList(w, r)
	case http.MethodPut:
		p.handleWorkflowSave(w, r)
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// handleWorkflowsList serves GET /api/workflows: this org's stored workflow
// entries with this instance's runtime status. The org comes from the server
// plugin context, never from the request body, query, or headers. A store
// failure is a 503: an unreadable list must never look like an org with no
// workflows.
func (p *Plugin) handleWorkflowsList(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !isAdmin(r) {
		http.Error(w, "Admin access required", http.StatusForbidden)
		return
	}

	orgID := getOrgID(r)
	configured, err := p.workflowEntryStore().ListWorkflows(r.Context(), orgID)
	if err != nil {
		p.logger.Error("Failed to read workflow entries", "orgId", orgID, "error", err)
		writeWorkflowJSONError(w, http.StatusServiceUnavailable, "Workflow entries are unavailable")
		return
	}
	p.writeWorkflowList(w, orgID, configured)
}

// workflowEntryValidationError names one rejected entry and why. The name is
// empty only when the defect is the list as a whole (the entry cap).
type workflowEntryValidationError struct {
	Name  string `json:"name"`
	Error string `json:"error"`
}

// writeWorkflowJSONError writes a small JSON error body so API clients can
// parse every failure, not only the success responses.
func writeWorkflowJSONError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(map[string]string{"error": message}); err != nil {
		return
	}
}

// writeWorkflowList renders one org's entries joined with this instance's
// runtime status. It is shared by GET and the PUT read-back so both answer the
// same shape.
func (p *Plugin) writeWorkflowList(w http.ResponseWriter, orgID int64, configured []WorkflowEntry) {
	entries := make([]workflowAPIEntry, 0, len(configured))
	for _, raw := range configured {
		// Resolve defaults on a copy: a stored entry may omit numeric fields,
		// and the tab must not render 0s or persist zeros back through a
		// toggle.
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
			// Schedulers are keyed by the trimmed name prepareWorkflowEntries
			// produced; a stored entry may still carry surrounding spaces.
			// Only this org's schedulers count: the same name may run for
			// another org.
			Running: p.workflows.isRunning(orgID, strings.TrimSpace(entry.Name)),
			Status:  p.workflowSessionStatus(entry.Name, orgID),
		})
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(map[string]interface{}{"workflows": entries}); err != nil {
		p.logger.Error("Failed to encode workflows list", "error", err)
	}
}

// handleWorkflowSave serves PUT /api/workflows: it replaces this org's whole
// entry list. The org is stamped server-side on every entry, so a client
// cannot write into another org by supplying orgId in the body. Validation is
// all-or-nothing: one bad entry rejects the request and nothing is written.
func (p *Plugin) handleWorkflowSave(w http.ResponseWriter, r *http.Request) {
	if !isAdmin(r) {
		http.Error(w, "Admin access required", http.StatusForbidden)
		return
	}
	orgID := getOrgID(r)

	var body struct {
		Workflows []WorkflowEntry `json:"workflows"`
	}
	if err := decodeJSONBody(w, r, &body, maxWorkflowSaveBodyBytes); err != nil {
		return
	}

	entries := make([]WorkflowEntry, 0, len(body.Workflows))
	if len(body.Workflows) > maxWorkflowEntriesPerOrg {
		writeWorkflowValidationErrors(w, []workflowEntryValidationError{{
			Error: fmt.Sprintf("at most %d workflow entries per org", maxWorkflowEntriesPerOrg),
		}})
		return
	}

	seen := map[string]bool{}
	problems := make([]workflowEntryValidationError, 0)
	for _, raw := range body.Workflows {
		entry := raw
		entry.OrgID = orgID
		entry.Name = strings.TrimSpace(entry.Name)
		// Defaults first, then validation, exactly as prepareWorkflows does:
		// an omitted interval means "use the default", not a floor violation.
		entry.applyDefaults()
		// The MCP catalog may still be connecting at route time, so unknown
		// tools are deferred to the first tick, as prepareWorkflows does when
		// its catalog is empty.
		if err := validateWorkflowEntry(entry, p.skillRegistry, nil); err != nil {
			problems = append(problems, workflowEntryValidationError{Name: entry.Name, Error: err.Error()})
			continue
		}
		if seen[entry.Name] {
			problems = append(problems, workflowEntryValidationError{
				Name:  entry.Name,
				Error: "duplicate workflow name",
			})
			continue
		}
		seen[entry.Name] = true
		entries = append(entries, entry)
	}
	if len(problems) > 0 {
		writeWorkflowValidationErrors(w, problems)
		return
	}

	store := p.workflowEntryStore()
	if err := store.SaveWorkflows(r.Context(), orgID, entries); err != nil {
		p.logger.Error("Failed to save workflow entries", "orgId", orgID, "error", err)
		writeWorkflowJSONError(w, http.StatusInternalServerError, "Failed to save workflow entries")
		return
	}
	// A save is the hot-apply seam: shares of a removed entry are revoked for
	// this org, then the live scheduler set converges at once. No instance
	// rebuild is involved.
	current := make(map[string]bool, len(entries))
	for _, entry := range entries {
		current[strings.TrimSpace(entry.Name)] = true
	}
	p.revokeRemovedWorkflowSharesForOrg(orgID, current)
	_, _ = p.reconcileWorkflows(r.Context())
	// Answer with a fresh read-back of the stored list, so the body is exactly
	// what the next GET returns.
	stored, err := store.ListWorkflows(r.Context(), orgID)
	if err != nil {
		p.logger.Error("Failed to read back workflow entries", "orgId", orgID, "error", err)
		writeWorkflowJSONError(w, http.StatusInternalServerError, "Failed to save workflow entries")
		return
	}
	p.writeWorkflowList(w, orgID, stored)
}

// writeWorkflowValidationErrors writes the 400 body listing every rejected
// entry. Nothing is persisted when it is called.
func writeWorkflowValidationErrors(w http.ResponseWriter, problems []workflowEntryValidationError) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusBadRequest)
	if err := json.NewEncoder(w).Encode(map[string]interface{}{"errors": problems}); err != nil {
		return
	}
}

// handleWorkflowRunShare serves POST /api/workflows/{name}/runs/{runId}/share:
// it gets or creates a read-only share link for one run's session and returns
// the share path. The share is owned by the workflow's synthetic user (the
// session owner), so creating it needs no cross-owner read. Admin only — the
// share grants unauthenticated read access to the session transcript.
//
// The stored payload is the same snapshot the share_session tool writes (see
// handleWorkflowShare): the session fields the viewer renders plus this run's
// events merged in. Assistant output and tool results reach the session store
// only after the agent loop ends, so a share minted mid-run holds a partial
// transcript; reusableWorkflowRunShare therefore reuses a share only when the
// run is terminal and the share postdates that terminal state.
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

	orgID := getOrgID(r)
	entries, err := p.workflowEntryStore().ListWorkflows(r.Context(), orgID)
	if err != nil {
		p.logger.Error("Failed to read workflow entries", "orgId", orgID, "error", err)
		http.Error(w, "Workflow entries are unavailable", http.StatusServiceUnavailable)
		return
	}
	var found bool
	for _, entry := range entries {
		if strings.TrimSpace(entry.Name) == name {
			found = true
			break
		}
	}
	if !found {
		http.Error(w, "Workflow not found", http.StatusNotFound)
		return
	}

	synthetic := syntheticWorkflowUserID(name, orgID)
	run, err := p.runStore.GetRun(runID)
	if err != nil || run == nil || run.SessionID == "" || run.UserID != synthetic || run.OrgID != orgID {
		http.Error(w, "Run not found", http.StatusNotFound)
		return
	}

	// The synthetic user owns the session, so the owner-scoped read works.
	// It is read before the reuse check because its UpdatedAt marks the
	// session write that completes the run's transcript.
	session, err := p.sessionStore.GetSession(run.SessionID, synthetic, orgID)
	if err != nil {
		http.Error(w, "Session not found", http.StatusNotFound)
		return
	}

	if share := reusableWorkflowRunShare(run, session, p.shareStore.GetSharesBySession(run.SessionID)); share != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{
			"shareId":  share.ShareID,
			"shareUrl": fmt.Sprintf("/a/%s/shared/%s?orgId=%d", PluginID, share.ShareID, orgID),
		})
		return
	}

	snapshot := workflowShareSnapshot{
		ID:               session.ID,
		Title:            session.Title,
		ConversationType: session.ConversationType,
		Workflow:         session.Workflow,
		CreatedAt:        session.CreatedAt,
		Messages:         append([]SessionMessage(nil), session.Messages...),
	}
	snapshot.Messages = appendRunTranscript(
		append([]SessionMessage(nil), session.Messages...),
		workflowRunTranscript(p, runID),
	)

	data, err := json.Marshal(snapshot)
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

// appendRunTranscript appends the reconstructed run transcript unless the
// session already ends with that same assistant message. consumeAgentEvents
// stores the final assistant message when the loop ends, so a finished run's
// session already holds it and appending again would render the investigation
// twice. A mid-run session holds only the user message, so the transcript is
// still appended there.
func appendRunTranscript(messages []SessionMessage, transcript []SessionMessage) []SessionMessage {
	if len(transcript) == 0 {
		return messages
	}
	for i := len(messages) - 1; i >= 0; i-- {
		if messages[i].Role != "assistant" {
			continue
		}
		if messages[i].Role == transcript[0].Role && messages[i].Content == transcript[0].Content {
			return messages
		}
		break
	}
	return append(messages, transcript...)
}

// reusableWorkflowRunShare returns the share an admin POST may reuse, or nil
// when a fresh share must be created. The rule, in order:
//
//  1. A running run is never reused: its transcript is still growing, so a
//     share minted earlier froze a partial transcript.
//  2. A share with ExpiresAt == nil is never reused (it would live forever);
//     today every share gets an expiry, but the reuse path does not rely on
//     that.
//  3. Only the newest unexpired share is a candidate, and only when it was
//     created at or after the run reached its terminal state. The terminal
//     timestamp is the later of the run record's UpdatedAt (stamped by
//     FinishRun) and the session's UpdatedAt: consumeAgentEvents appends the
//     assistant message after FinishRun, so only the session write proves
//     the transcript is complete. A zero terminal timestamp means no reuse.
//
// Every other case creates a fresh share instead of handing out a stale one.
func reusableWorkflowRunShare(run *AgentRun, session *ChatSession, shares []*ShareMetadata) *ShareMetadata {
	if run == nil || run.Status == RunStatusRunning {
		return nil
	}
	terminal := run.UpdatedAt
	if session != nil && session.UpdatedAt.After(terminal) {
		terminal = session.UpdatedAt
	}
	if terminal.IsZero() {
		return nil
	}

	now := time.Now().UTC()
	var newest *ShareMetadata
	for _, share := range shares {
		if share == nil || share.ExpiresAt == nil || !share.ExpiresAt.After(now) {
			continue
		}
		if newest == nil || share.CreatedAt.After(newest.CreatedAt) {
			newest = share
		}
	}
	if newest == nil || newest.CreatedAt.Before(terminal) {
		return nil
	}
	return newest
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
	// prepareWorkflowEntries trims entry names before schedulers start, so
	// session owners are keyed by the trimmed name; trim here to match.
	name = strings.TrimSpace(runIDPart)

	orgID := getOrgID(r)
	entries, err := p.workflowEntryStore().ListWorkflows(r.Context(), orgID)
	if err != nil {
		p.logger.Error("Failed to read workflow entries", "workflow", name, "orgId", orgID, "error", err)
		http.Error(w, "Workflow entries are unavailable", http.StatusServiceUnavailable)
		return
	}
	var entry *WorkflowEntry
	for i := range entries {
		// The stored payload may still carry surrounding spaces from a
		// hand-edited record, so compare on the trimmed name.
		if strings.TrimSpace(entries[i].Name) == name {
			entry = &entries[i]
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

	runs, err := p.runStore.ListRuns(syntheticWorkflowUserID(name, orgID), orgID, limit)
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
