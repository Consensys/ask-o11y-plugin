package plugin

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"consensys-asko11y-app/pkg/agent"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
)

func TestWorkflowStatusStoreRecordsTicksAndSessions(t *testing.T) {
	store := NewWorkflowStatusStore()

	if got := store.Get("never-ticked"); got.LastTickOutcome != "" || got.Started != 0 {
		t.Fatalf("unknown workflow must return the zero status, got %+v", got)
	}

	store.RecordTick("wf", "executed")
	status := store.Get("wf")
	if status.LastTickOutcome != "executed" || status.LastTickAt == nil {
		t.Fatalf("tick not recorded: %+v", status)
	}
	if time.Since(*status.LastTickAt) > time.Minute {
		t.Fatalf("tick time not current: %v", status.LastTickAt)
	}

	store.RecordTickError("wf", "tick lock unavailable")
	status = store.Get("wf")
	if status.LastTickOutcome != "skip_error" || status.LastError != "tick lock unavailable" {
		t.Fatalf("tick error not recorded: %+v", status)
	}

	for i := 0; i < 3; i++ {
		store.RecordSession("wf", "started")
		store.RecordSession("wf", "completed")
	}
	store.RecordSession("wf", "timeout")
	store.RecordSession("wf", "not-an-outcome") // unknown outcomes count nothing
	status = store.Get("wf")
	if status.Started != 3 || status.Completed != 3 || status.Timeout != 1 || status.Failed != 0 {
		t.Fatalf("session outcomes miscounted: %+v", status)
	}

	// A recovered tick clears the stale error; a session-level failure
	// keeps the executed tick outcome.
	store.RecordTickError("wf", "boom")
	store.RecordTick("wf", "executed")
	if got := store.Get("wf"); got.LastTickOutcome != "executed" || got.LastError != "" {
		t.Fatalf("recovered tick must clear the error: %+v", got)
	}
	store.RecordTick("wf", "executed")
	store.RecordSessionError("wf", "session start failed")
	if got := store.Get("wf"); got.LastTickOutcome != "executed" || got.LastError != "session start failed" {
		t.Fatalf("session error must not change the tick outcome: %+v", got)
	}

	// A nil store (white-box test plugins) answers zero, never panics.
	var nilStore *WorkflowStatusStore
	nilStore.RecordTick("wf", "executed")
	nilStore.RecordSession("wf", "started")
	if got := nilStore.Get("wf"); got.Started != 0 {
		t.Fatalf("nil store must answer zero, got %+v", got)
	}
}

func workflowsListRequest(t *testing.T, p *Plugin, role string) (*http.Response, map[string]interface{}) {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/api/workflows", nil)
	req = withTestIdentity(req, 1, "admin-1", role)
	rec := httptest.NewRecorder()
	p.handleWorkflowsList(rec, req)

	var body map[string]interface{}
	if rec.Code == http.StatusOK {
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatalf("invalid JSON body: %v", err)
		}
	}
	return rec.Result(), body
}

func TestHandleWorkflowsListAdminSeesEntriesAndStatus(t *testing.T) {
	p := newAgentRunTestPlugin(t)
	p.settings.Workflows = []WorkflowEntry{
		{
			Name: "running-wf", Enabled: true, Skill: "dispatch",
			IntervalSec: 300, SessionTimeoutSeconds: 420, MaxConcurrentSessions: 5,
			ToolAllowlist: []string{"irm_list_alert_groups"}, Model: "base",
		},
		// Zero numeric fields resolve to defaults: raw disabled entries never
		// pass prepareWorkflows, and the tab must not render or persist 0s.
		{Name: "off-wf", Skill: "janitor", ToolAllowlist: []string{"irm_list_alert_groups"}},
	}
	running := NewWorkflowScheduler(context.Background(), p, p.settings.Workflows[0])
	stopped := NewWorkflowScheduler(context.Background(), p, p.settings.Workflows[1])
	stopped.cancel() // simulate deferred validation ending it
	p.workflows = &WorkflowManager{schedulers: []*WorkflowScheduler{running, stopped}}
	p.workflowStatus = NewWorkflowStatusStore()
	p.workflowStatus.RecordTick("running-wf", "executed")
	// Durable counts come from the run store of the requesting org: two
	// completed, one timeout. No identity seeding is needed to count.
	synthetic := syntheticWorkflowUserID("running-wf")
	p.runStore.CreateRun("r-1", synthetic, 1, "s-1")
	p.runStore.FinishRun("r-1", RunStatusCompleted, "")
	p.runStore.CreateRun("r-2", synthetic, 1, "s-2")
	p.runStore.FinishRun("r-2", RunStatusCompleted, "")
	p.runStore.CreateRun("r-3", synthetic, 1, "s-3")
	p.runStore.FinishRun("r-3", RunStatusFailed, "workflow session exceeded its 420 second timeout")

	resp, body := workflowsListRequest(t, p, "Admin")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("admin request must succeed, got %d", resp.StatusCode)
	}
	rows, ok := body["workflows"].([]interface{})
	if !ok || len(rows) != 2 {
		t.Fatalf("expected 2 workflow rows, got %v", body)
	}
	first := rows[0].(map[string]interface{})
	if first["name"] != "running-wf" || first["running"] != true {
		t.Fatalf("running workflow not flagged: %v", first)
	}
	status := first["status"].(map[string]interface{})
	if status["lastTickOutcome"] != "executed" {
		t.Fatalf("tick status not joined: %v", status)
	}
	// Row counters must match the durable run records, not the in-memory view.
	if status["started"].(float64) != 3 || status["completed"].(float64) != 2 || status["timeout"].(float64) != 1 {
		t.Fatalf("durable counters wrong: %v", status)
	}
	second := rows[1].(map[string]interface{})
	if second["enabled"] != false || second["running"] != false {
		t.Fatalf("disabled workflow must not run: %v", second)
	}
	if second["intervalSeconds"].(float64) != workflowDefaultIntervalSeconds {
		t.Fatalf("raw zero interval must resolve to the default, got %v", second["intervalSeconds"])
	}
	if second["sessionTimeoutSeconds"].(float64) != workflowDefaultTimeoutSeconds {
		t.Fatalf("raw zero timeout must resolve to the default, got %v", second["sessionTimeoutSeconds"])
	}
	_ = log.DefaultLogger
}

func TestHandleWorkflowsListRejectsNonAdminAndWrongMethod(t *testing.T) {
	p := newAgentRunTestPlugin(t)
	p.settings.Workflows = []WorkflowEntry{{Name: "wf", Skill: "dispatch", ToolAllowlist: []string{"t"}}}
	p.workflowStatus = NewWorkflowStatusStore()

	if resp, _ := workflowsListRequest(t, p, "Viewer"); resp.StatusCode != http.StatusForbidden {
		t.Fatalf("viewer must be refused, got %d", resp.StatusCode)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/workflows", nil)
	req = withTestIdentity(req, 1, "admin-1", "Admin")
	rec := httptest.NewRecorder()
	p.handleWorkflowsList(rec, req)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("POST must be refused, got %d", rec.Code)
	}
}

func TestHandleWorkflowRunsListsSyntheticUserRuns(t *testing.T) {
	p := newAgentRunTestPlugin(t)
	p.settings.Workflows = []WorkflowEntry{
		{Name: "runs-wf", Enabled: true, Skill: "dispatch", ToolAllowlist: []string{"t"}},
	}
	synthetic := syntheticWorkflowUserID("runs-wf")
	p.runStore.CreateRun("run-1", synthetic, 1, "sess-1")
	p.runStore.FinishRun("run-1", RunStatusCompleted, "")
	p.runStore.CreateRun("run-2", synthetic, 1, "sess-2")
	p.runStore.FinishRun("run-2", RunStatusFailed, "boom")

	req := httptest.NewRequest(http.MethodGet, "/api/workflows/runs-wf/runs?limit=10", nil)
	req = withTestIdentity(req, 1, "admin-1", "Admin")
	rec := httptest.NewRecorder()
	p.handleWorkflowRuns(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("admin runs request must succeed, got %d: %s", rec.Code, rec.Body.String())
	}
	var body struct {
		Workflow string `json:"workflow"`
		Runs     []struct {
			RunID  string    `json:"runId"`
			Status RunStatus `json:"status"`
			Error  string    `json:"error"`
		} `json:"runs"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	if body.Workflow != "runs-wf" || len(body.Runs) != 2 {
		t.Fatalf("expected 2 runs for runs-wf, got %+v", body)
	}
	if body.Runs[0].RunID != "run-2" || body.Runs[0].Status != RunStatusFailed || body.Runs[0].Error != "boom" {
		t.Fatalf("newest run first with its error, got %+v", body.Runs[0])
	}

	// Unknown workflow, wrong method, and non-admin all refuse.
	req = httptest.NewRequest(http.MethodGet, "/api/workflows/missing/runs", nil)
	req = withTestIdentity(req, 1, "admin-1", "Admin")
	rec = httptest.NewRecorder()
	p.handleWorkflowRuns(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("unknown workflow must 404, got %d", rec.Code)
	}
	req = httptest.NewRequest(http.MethodGet, "/api/workflows/runs-wf/runs", nil)
	req = withTestIdentity(req, 1, "user-7", "Viewer")
	rec = httptest.NewRecorder()
	p.handleWorkflowRuns(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("viewer must be refused, got %d", rec.Code)
	}
}

// A workflow saved with surrounding whitespace still matches the scheduler
// that runs its trimmed name: the runs listing answers 200 with entries, and
// the list reports the entry as running. Before the trim, both compared raw
// against trimmed and 404'd / showed "stopped" (review regression).
func TestHandleWorkflowLookupsTrimRawSavedName(t *testing.T) {
	p := newAgentRunTestPlugin(t)
	const trimmed = "Nightly RCA"
	p.settings.Workflows = []WorkflowEntry{
		{Name: "  " + trimmed + "  ", Enabled: true, Skill: "dispatch",
			IntervalSec: 300, SessionTimeoutSeconds: 420, ToolAllowlist: []string{"t"}},
	}
	// prepareWorkflows hands schedulers the trimmed name.
	scheduler := NewWorkflowScheduler(context.Background(), p, WorkflowEntry{
		Name: trimmed, Enabled: true, Skill: "dispatch",
		IntervalSec: 300, SessionTimeoutSeconds: 420, ToolAllowlist: []string{"t"},
	})
	p.workflows = &WorkflowManager{schedulers: []*WorkflowScheduler{scheduler}}
	p.workflowStatus = NewWorkflowStatusStore()
	p.workflowStatus.RecordTick(trimmed, "executed")

	synthetic := syntheticWorkflowUserID(trimmed)
	p.runStore.CreateRun("trim-run-1", synthetic, 1, "trim-sess-1")
	p.runStore.FinishRun("trim-run-1", RunStatusCompleted, "")

	resp, body := workflowsListRequest(t, p, "Admin")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("admin list must succeed, got %d", resp.StatusCode)
	}
	rows := body["workflows"].([]interface{})
	first := rows[0].(map[string]interface{})
	if first["running"] != true {
		t.Fatalf("entry saved with whitespace must report running: %v", first)
	}
	status := first["status"].(map[string]interface{})
	if status["lastTickOutcome"] != "executed" || status["started"].(float64) != 1 {
		t.Fatalf("trimmed status not joined: %v", status)
	}

	// The UI encodes the name; the server decodes "%20" back to a space.
	req := httptest.NewRequest(http.MethodGet, "/api/workflows/Nightly%20RCA/runs?limit=10", nil)
	req = withTestIdentity(req, 1, "admin-1", "Admin")
	rec := httptest.NewRecorder()
	p.handleWorkflowRuns(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("runs listing must succeed for a whitespace-saved entry, got %d: %s", rec.Code, rec.Body.String())
	}
	var runsBody struct {
		Workflow string `json:"workflow"`
		Runs     []struct {
			RunID string `json:"runId"`
		} `json:"runs"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &runsBody); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	if runsBody.Workflow != trimmed || len(runsBody.Runs) != 1 || runsBody.Runs[0].RunID != "trim-run-1" {
		t.Fatalf("expected the workflow's run, got %+v", runsBody)
	}
}

func TestWorkflowRunShareGetOrCreate(t *testing.T) {
	p := newAgentRunTestPlugin(t)
	p.shareStore = NewShareStore(p.logger, NewInMemoryRateLimiter(p.logger))
	orgID := int64(1)
	synthetic := syntheticWorkflowUserID("share-wf")
	p.settings.Workflows = []WorkflowEntry{
		{Name: "share-wf", Enabled: true, Skill: "dispatch", ToolAllowlist: []string{"t"}},
	}
	wfSession, err := p.sessionStore.CreateSession(synthetic, orgID, "Workflow share-wf: dispatch", []SessionMessage{{Role: "user", Content: "go"}})
	if err != nil {
		t.Fatalf("workflow session creation failed: %v", err)
	}
	convType := workflowConversationType
	workflowName := "share-wf"
	if err := p.sessionStore.UpdateSession(wfSession.ID, synthetic, orgID, SessionUpdate{ConversationType: &convType, Workflow: &workflowName}); err != nil {
		t.Fatalf("workflow tagging failed: %v", err)
	}
	runID := "share-run-1"
	p.runStore.CreateRun(runID, synthetic, orgID, wfSession.ID)
	p.runStore.FinishRun(runID, RunStatusCompleted, "")

	postShare := func(role, login, wf, run string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, "/api/workflows/"+wf+"/runs/"+run+"/share", nil)
		req = withTestIdentity(req, orgID, login, role)
		rec := httptest.NewRecorder()
		p.handleWorkflowRuns(rec, req)
		return rec
	}

	// Non-admin refused; unknown workflow and unknown run 404.
	if rec := postShare("Viewer", "user-8", "share-wf", runID); rec.Code != http.StatusForbidden {
		t.Fatalf("viewer must be refused, got %d", rec.Code)
	}
	if rec := postShare("Admin", "admin-1", "missing", runID); rec.Code != http.StatusNotFound {
		t.Fatalf("unknown workflow must 404, got %d", rec.Code)
	}
	if rec := postShare("Admin", "admin-1", "share-wf", "nope"); rec.Code != http.StatusNotFound {
		t.Fatalf("unknown run must 404, got %d", rec.Code)
	}

	// Admin gets a share URL pointing at the shared-session view.
	rec := postShare("Admin", "admin-1", "share-wf", runID)
	if rec.Code != http.StatusOK {
		t.Fatalf("share creation failed: %d %s", rec.Code, rec.Body.String())
	}
	var body struct {
		ShareID  string `json:"shareId"`
		ShareURL string `json:"shareUrl"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("invalid share response: %v", err)
	}
	if body.ShareID == "" || body.ShareURL != "/a/"+PluginID+"/shared/"+body.ShareID+"?orgId=1" {
		t.Fatalf("unexpected share payload: %+v", body)
	}

	// A second call reuses the same share (get-or-create, not one per click).
	rec2 := postShare("Admin", "admin-1", "share-wf", runID)
	var body2 struct {
		ShareID string `json:"shareId"`
	}
	if err := json.Unmarshal(rec2.Body.Bytes(), &body2); err != nil || body2.ShareID != body.ShareID {
		t.Fatalf("second share call must reuse the share: %+v vs %+v", body2, body)
	}
}

// workflowShareFixture builds one admin-shareable workflow run around an
// in-memory share store, returning the plugin and the run/session IDs.
func workflowShareFixture(t *testing.T, wfName, runID string) (*Plugin, string, int64, int64) {
	t.Helper()
	p := newAgentRunTestPlugin(t)
	p.shareStore = NewShareStore(p.logger, NewInMemoryRateLimiter(p.logger))
	orgID := int64(1)
	synthetic := syntheticWorkflowUserID(wfName)
	p.settings.Workflows = []WorkflowEntry{
		{Name: wfName, Enabled: true, Skill: "dispatch", ToolAllowlist: []string{"t"}},
	}
	session, err := p.sessionStore.CreateSession(synthetic, orgID, "Workflow "+wfName+": dispatch",
		[]SessionMessage{{Role: "user", Content: "go"}})
	if err != nil {
		t.Fatalf("workflow session creation failed: %v", err)
	}
	convType := workflowConversationType
	name := wfName
	if err := p.sessionStore.UpdateSession(session.ID, synthetic, orgID, SessionUpdate{ConversationType: &convType, Workflow: &name}); err != nil {
		t.Fatalf("workflow tagging failed: %v", err)
	}
	p.runStore.CreateRun(runID, synthetic, orgID, session.ID)
	return p, session.ID, synthetic, orgID
}

func postWorkflowRunShare(t *testing.T, p *Plugin, orgID int64, wfName, runID string) string {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/workflows/"+wfName+"/runs/"+runID+"/share", nil)
	req = withTestIdentity(req, orgID, "admin-1", "Admin")
	rec := httptest.NewRecorder()
	p.handleWorkflowRuns(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("share request failed: %d %s", rec.Code, rec.Body.String())
	}
	var body struct {
		ShareID string `json:"shareId"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil || body.ShareID == "" {
		t.Fatalf("invalid share response: %v %s", err, rec.Body.String())
	}
	return body.ShareID
}

func sharedSnapshot(t *testing.T, p *Plugin, shareID string) workflowShareSnapshot {
	t.Helper()
	share, err := p.shareStore.GetShare(shareID)
	if err != nil {
		t.Fatalf("share %q not found: %v", shareID, err)
	}
	var snapshot workflowShareSnapshot
	if err := json.Unmarshal(share.SessionData, &snapshot); err != nil {
		t.Fatalf("share payload is not a session snapshot: %v", err)
	}
	return snapshot
}

func snapshotContains(snapshot workflowShareSnapshot, want string) bool {
	for _, message := range snapshot.Messages {
		if message.Content == want {
			return true
		}
	}
	return false
}

func snapshotMessageCount(snapshot workflowShareSnapshot, role, content string) int {
	count := 0
	for _, message := range snapshot.Messages {
		if message.Role == role && message.Content == content {
			count++
		}
	}
	return count
}

// A share minted while the run is still executing froze a partial transcript.
// Once the run completes, the next admin POST must not hand that share out
// again: it must create one that holds the merged transcript.
func TestWorkflowRunShareMidRunNotReusedAfterCompletion(t *testing.T) {
	const wfName = "midrun-wf"
	const runID = "midrun-run-1"
	p, sessionID, synthetic, orgID := workflowShareFixture(t, wfName, runID)

	midRun := postWorkflowRunShare(t, p, orgID, wfName, runID)

	// Mirror consumeAgentEvents: events, then FinishRun, then the session
	// append that carries the assistant message.
	p.runStore.AppendEvent(runID, agent.SSEEvent{Type: "content", Data: agent.ContentEvent{Content: "the final answer"}})
	p.runStore.FinishRun(runID, RunStatusCompleted, "")
	if err := p.sessionStore.AppendMessages(sessionID, synthetic, orgID,
		[]SessionMessage{{Role: "assistant", Content: "the final answer"}}); err != nil {
		t.Fatalf("append assistant message failed: %v", err)
	}

	after := postWorkflowRunShare(t, p, orgID, wfName, runID)
	if after == midRun {
		t.Fatal("a share created mid-run must not be reused after the run completes")
	}
	if !snapshotContains(sharedSnapshot(t, p, after), "the final answer") {
		t.Fatal("the fresh share must carry the completed transcript")
	}
}

// A terminal run's share is built from the run events, so the transcript is
// present even when the session store was never written. A run whose loop died
// before it stored the assistant message is exactly this case: the transcript
// must appear once, not be lost.
func TestWorkflowRunShareTerminalRunIncludesTranscript(t *testing.T) {
	const wfName = "terminal-wf"
	const runID = "terminal-run-1"
	p, _, _, orgID := workflowShareFixture(t, wfName, runID)

	p.runStore.AppendEvent(runID, agent.SSEEvent{Type: "content", Data: agent.ContentEvent{Content: "reconstructed answer"}})
	p.runStore.AppendEvent(runID, agent.SSEEvent{Type: "tool_call_start", Data: agent.ToolCallStartEvent{ID: "tc-1", Name: "query", Arguments: "{}"}})
	p.runStore.AppendEvent(runID, agent.SSEEvent{Type: "tool_call_result", Data: agent.ToolCallResultEvent{ID: "tc-1", Name: "query", Content: "rows"}})
	p.runStore.FinishRun(runID, RunStatusCompleted, "")

	shareID := postWorkflowRunShare(t, p, orgID, wfName, runID)
	snapshot := sharedSnapshot(t, p, shareID)
	if got := snapshotMessageCount(snapshot, "assistant", "reconstructed answer"); got != 1 {
		t.Fatalf("share snapshot must carry the reconstructed transcript exactly once, got %d: %+v", got, snapshot.Messages)
	}
	if len(snapshot.Messages) != 2 {
		t.Fatalf("snapshot must hold the user message plus one transcript, got %+v", snapshot.Messages)
	}
}

// A completed run's session already stores the final assistant message (written
// by consumeAgentEvents when the loop ends), and its events reconstruct the
// same message. The share must not render the investigation twice.
func TestWorkflowRunShareCompletedRunStoresTranscriptOnce(t *testing.T) {
	const wfName = "dedupe-wf"
	const runID = "dedupe-run-1"
	p, sessionID, synthetic, orgID := workflowShareFixture(t, wfName, runID)

	p.runStore.AppendEvent(runID, agent.SSEEvent{Type: "content", Data: agent.ContentEvent{Content: "the final answer"}})
	p.runStore.FinishRun(runID, RunStatusCompleted, "")
	if err := p.sessionStore.AppendMessages(sessionID, synthetic, orgID,
		[]SessionMessage{{Role: "assistant", Content: "the final answer"}}); err != nil {
		t.Fatalf("append assistant message failed: %v", err)
	}

	shareID := postWorkflowRunShare(t, p, orgID, wfName, runID)
	snapshot := sharedSnapshot(t, p, shareID)
	if got := snapshotMessageCount(snapshot, "assistant", "the final answer"); got != 1 {
		t.Fatalf("a completed run must render its transcript exactly once, got %d: %+v", got, snapshot.Messages)
	}
	if len(snapshot.Messages) != 2 {
		t.Fatalf("snapshot must hold the user message plus the stored assistant message, got %+v", snapshot.Messages)
	}
}

// The share payload is the session-shaped snapshot, not the full ChatSession:
// agent internals and usage stats stay out of an unauthenticated payload.
func TestWorkflowRunShareSnapshotOmitsSessionInternals(t *testing.T) {
	const wfName = "snapshot-wf"
	const runID = "snapshot-run-1"
	p, sessionID, synthetic, orgID := workflowShareFixture(t, wfName, runID)

	summary := "internal summary"
	model := "large"
	if err := p.sessionStore.UpdateSession(sessionID, synthetic, orgID, SessionUpdate{Summary: &summary, Model: &model}); err != nil {
		t.Fatalf("session update failed: %v", err)
	}
	if err := p.sessionStore.SetActiveRunID(sessionID, synthetic, orgID, runID); err != nil {
		t.Fatalf("active run ID update failed: %v", err)
	}
	if err := p.sessionStore.IncrementStats(sessionID, synthetic, orgID, SessionStatsDelta{RunCount: 1, TotalTokens: 42}); err != nil {
		t.Fatalf("stats increment failed: %v", err)
	}
	p.runStore.FinishRun(runID, RunStatusCompleted, "")

	shareID := postWorkflowRunShare(t, p, orgID, wfName, runID)
	share, err := p.shareStore.GetShare(shareID)
	if err != nil {
		t.Fatalf("share not found: %v", err)
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(share.SessionData, &raw); err != nil {
		t.Fatalf("share payload is not JSON: %v", err)
	}
	for _, field := range []string{"summary", "model", "activeRunId", "totalTokens"} {
		if _, exists := raw[field]; exists {
			t.Fatalf("share snapshot must omit %q, got: %s", field, share.SessionData)
		}
	}
	if _, exists := raw["messages"]; !exists {
		t.Fatalf("share snapshot must keep messages: %s", share.SessionData)
	}
}

// Removing a workflow entry from the applied settings revokes that workflow's
// shares, and leaves the other entries' shares alone.
func TestRemovedWorkflowEntryRevokesItsShares(t *testing.T) {
	p := newAgentRunTestPlugin(t)
	p.shareStore = NewShareStore(p.logger, NewInMemoryRateLimiter(p.logger))
	orgID := int64(1)

	// The settings load that started both workflows.
	p.revokeRemovedWorkflowShares([]WorkflowEntry{{Name: "gone-wf"}, {Name: "kept-wf"}})

	hours := 24
	payload := []byte(`{"id":"s","messages":[{"role":"user","content":"x"}]}`)
	goneShare, err := p.shareStore.CreateShare("s-gone", payload, orgID, syntheticWorkflowUserID("gone-wf"), &hours)
	if err != nil {
		t.Fatalf("gone share creation failed: %v", err)
	}
	keptShare, err := p.shareStore.CreateShare("s-kept", payload, orgID, syntheticWorkflowUserID("kept-wf"), &hours)
	if err != nil {
		t.Fatalf("kept share creation failed: %v", err)
	}

	// The next settings load no longer lists gone-wf.
	p.revokeRemovedWorkflowShares([]WorkflowEntry{{Name: "kept-wf"}})

	if _, err := p.shareStore.GetShare(goneShare.ShareID); err == nil {
		t.Fatal("a removed workflow's share must be revoked")
	}
	if _, err := p.shareStore.GetShare(keptShare.ShareID); err != nil {
		t.Fatalf("a configured workflow's share must survive: %v", err)
	}
}
