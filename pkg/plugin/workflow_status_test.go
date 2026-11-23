package plugin

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"consensys-asko11y-app/pkg/agent"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
)

func TestWorkflowStatusStoreRecordsTicksAndSessions(t *testing.T) {
	store := NewWorkflowStatusStore()

	if got := store.Get(1, "never-ticked"); got.LastTickOutcome != "" || got.Started != 0 {
		t.Fatalf("unknown workflow must return the zero status, got %+v", got)
	}

	store.RecordTick(1, "wf", "executed")
	status := store.Get(1, "wf")
	if status.LastTickOutcome != "executed" || status.LastTickAt == nil {
		t.Fatalf("tick not recorded: %+v", status)
	}
	if time.Since(*status.LastTickAt) > time.Minute {
		t.Fatalf("tick time not current: %v", status.LastTickAt)
	}

	store.RecordTickError(1, "wf", "tick lock unavailable")
	status = store.Get(1, "wf")
	if status.LastTickOutcome != "skip_error" || status.LastError != "tick lock unavailable" {
		t.Fatalf("tick error not recorded: %+v", status)
	}

	for i := 0; i < 3; i++ {
		store.RecordSession(1, "wf", "started")
		store.RecordSession(1, "wf", "completed")
	}
	store.RecordSession(1, "wf", "timeout")
	store.RecordSession(1, "wf", "not-an-outcome") // unknown outcomes count nothing
	status = store.Get(1, "wf")
	if status.Started != 3 || status.Completed != 3 || status.Timeout != 1 || status.Failed != 0 {
		t.Fatalf("session outcomes miscounted: %+v", status)
	}

	// A recovered tick clears the stale error; a session-level failure
	// keeps the executed tick outcome.
	store.RecordTickError(1, "wf", "boom")
	store.RecordTick(1, "wf", "executed")
	if got := store.Get(1, "wf"); got.LastTickOutcome != "executed" || got.LastError != "" {
		t.Fatalf("recovered tick must clear the error: %+v", got)
	}
	store.RecordTick(1, "wf", "executed")
	store.RecordSessionError(1, "wf", "session start failed")
	if got := store.Get(1, "wf"); got.LastTickOutcome != "executed" || got.LastError != "session start failed" {
		t.Fatalf("session error must not change the tick outcome: %+v", got)
	}

	// A nil store (white-box test plugins) answers zero, never panics.
	var nilStore *WorkflowStatusStore
	nilStore.RecordTick(1, "wf", "executed")
	nilStore.RecordSession(1, "wf", "started")
	if got := nilStore.Get(1, "wf"); got.Started != 0 {
		t.Fatalf("nil store must answer zero, got %+v", got)
	}
}

// Two orgs may run the same workflow name on one plugin instance. Each org's
// status row must show its own tick state: when the store was keyed by name
// alone, the second org's tick overwrote the first org's, and each GET read
// whichever org ticked last.
func TestWorkflowStatusIsOrgScoped(t *testing.T) {
	const name = "shared-name-wf"
	store := NewWorkflowStatusStore()

	store.RecordTick(1, name, "executed")
	orgOne := store.Get(1, name)
	store.RecordTickError(2, name, "tick lock unavailable")
	store.RecordSession(1, name, "started")
	store.RecordSession(2, name, "failed")

	gotOne := store.Get(1, name)
	if gotOne.LastTickOutcome != "executed" || gotOne.LastError != "" {
		t.Fatalf("org 1 must keep its own tick state, got %+v", gotOne)
	}
	if orgOne.LastTickAt == nil || gotOne.LastTickAt == nil || !gotOne.LastTickAt.Equal(*orgOne.LastTickAt) {
		t.Fatalf("org 2's tick must not rewrite org 1's tick time: before %v after %v",
			orgOne.LastTickAt, gotOne.LastTickAt)
	}
	gotTwo := store.Get(2, name)
	if gotTwo.LastTickOutcome != "skip_error" || gotTwo.LastError != "tick lock unavailable" {
		t.Fatalf("org 2 must keep its own tick state, got %+v", gotTwo)
	}
	if gotTwo.LastTickAt == nil || !gotTwo.LastTickAt.After(*orgOne.LastTickAt) {
		t.Fatalf("each org must carry its own tick time: org1 %v org2 %v",
			orgOne.LastTickAt, gotTwo.LastTickAt)
	}
	if gotOne = store.Get(1, name); gotOne.Started != 1 || gotOne.Failed != 0 {
		t.Fatalf("org 1's counters must not count org 2's sessions, got %+v", gotOne)
	}
	if gotTwo = store.Get(2, name); gotTwo.Started != 0 || gotTwo.Failed != 1 {
		t.Fatalf("org 2's counters must not count org 1's sessions, got %+v", gotTwo)
	}

	// The API read path joins the status by org too: same name, two lists,
	// two independent tick outcomes.
	p, _ := newRedisBackedWorkflowPlugin(t)
	orgOneEntry := validStoredWorkflowEntry(name)
	orgOneEntry.OrgID = 1
	orgTwoEntry := validStoredWorkflowEntry(name)
	orgTwoEntry.OrgID = 2
	if err := p.workflowEntryStore().SaveWorkflows(context.Background(), 1, []WorkflowEntry{orgOneEntry}); err != nil {
		t.Fatalf("org 1 store seed failed: %v", err)
	}
	if err := p.workflowEntryStore().SaveWorkflows(context.Background(), 2, []WorkflowEntry{orgTwoEntry}); err != nil {
		t.Fatalf("org 2 store seed failed: %v", err)
	}
	p.workflowStatus = NewWorkflowStatusStore()
	p.workflowStatus.RecordTick(1, name, "executed")
	p.workflowStatus.RecordTick(2, name, "skip_lock")

	statusOf := func(orgID int64) map[string]interface{} {
		rec := getWorkflowsRequest(t, p, orgID, "Admin")
		if rec.Code != http.StatusOK {
			t.Fatalf("org %d GET must succeed, got %d: %s", orgID, rec.Code, rec.Body.String())
		}
		var body struct {
			Workflows []struct {
				Status map[string]interface{} `json:"status"`
			} `json:"workflows"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatalf("org %d invalid JSON body: %v", orgID, err)
		}
		if len(body.Workflows) != 1 {
			t.Fatalf("org %d must see exactly its own entry, got %d", orgID, len(body.Workflows))
		}
		return body.Workflows[0].Status
	}
	if got := statusOf(1)["lastTickOutcome"]; got != "executed" {
		t.Fatalf("org 1's GET must report its own tick outcome, got %v", got)
	}
	if got := statusOf(2)["lastTickOutcome"]; got != "skip_lock" {
		t.Fatalf("org 2's GET must report its own tick outcome, got %v", got)
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
	p, _ := newRedisBackedWorkflowPlugin(t)
	configured := []WorkflowEntry{
		{
			Name: "running-wf", OrgID: 1, Enabled: true, Skill: "dispatch",
			IntervalSec: 300, SessionTimeoutSeconds: 420, MaxConcurrentSessions: 5,
			ToolAllowlist: []string{"irm_list_alert_groups"}, Model: "base",
		},
		// Zero numeric fields resolve to defaults: raw disabled entries never
		// pass prepareWorkflows, and the tab must not render or persist 0s.
		{Name: "off-wf", OrgID: 1, Skill: "janitor", ToolAllowlist: []string{"irm_list_alert_groups"}},
	}
	if err := p.workflowEntryStore().SaveWorkflows(context.Background(), 1, configured); err != nil {
		t.Fatalf("workflow store seed failed: %v", err)
	}
	// The scheduler view is joined by org+name; fixtures are tracked in the
	// manager directly.
	running := NewWorkflowScheduler(context.Background(), p, configured[0])
	stopped := NewWorkflowScheduler(context.Background(), p, configured[1])
	stopped.cancel() // simulate deferred validation ending it
	p.workflows.schedulers[workflowKey{orgID: 1, name: "running-wf"}] = running
	p.workflows.entries[workflowKey{orgID: 1, name: "running-wf"}] = configured[0]
	p.workflows.schedulers[workflowKey{orgID: 1, name: "off-wf"}] = stopped
	p.workflows.entries[workflowKey{orgID: 1, name: "off-wf"}] = configured[1]
	p.workflowStatus = NewWorkflowStatusStore()
	p.workflowStatus.RecordTick(1, "running-wf", "executed")
	// Durable counts come from the run store of the requesting org: two
	// completed, one timeout. No identity seeding is needed to count.
	synthetic := syntheticWorkflowUserID("running-wf", 1)
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
	p, _ := newRedisBackedWorkflowPlugin(t)
	if err := p.workflowEntryStore().SaveWorkflows(context.Background(), 1, []WorkflowEntry{
		{Name: "runs-wf", Enabled: true, Skill: "dispatch", ToolAllowlist: []string{"t"}},
	}); err != nil {
		t.Fatalf("workflow store seed failed: %v", err)
	}
	synthetic := syntheticWorkflowUserID("runs-wf", 1)
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
	p, _ := newRedisBackedWorkflowPlugin(t)
	const trimmed = "Nightly RCA"
	configured := []WorkflowEntry{
		{Name: "  " + trimmed + "  ", OrgID: 1, Enabled: true, Skill: "dispatch",
			IntervalSec: 300, SessionTimeoutSeconds: 420, ToolAllowlist: []string{"t"}},
	}
	// The entry source of GET is the org store; the raw name keeps its
	// surrounding whitespace until schedulers trim it.
	if err := p.workflowEntryStore().SaveWorkflows(context.Background(), 1, configured); err != nil {
		t.Fatalf("workflow store seed failed: %v", err)
	}
	// prepareWorkflowEntries hands schedulers the trimmed name.
	scheduler := NewWorkflowScheduler(context.Background(), p, WorkflowEntry{
		Name: trimmed, OrgID: 1, Enabled: true, Skill: "dispatch",
		IntervalSec: 300, SessionTimeoutSeconds: 420, ToolAllowlist: []string{"t"},
	})
	p.workflows.schedulers[workflowKey{orgID: 1, name: trimmed}] = scheduler
	p.workflows.entries[workflowKey{orgID: 1, name: trimmed}] = scheduler.entry
	p.workflowStatus = NewWorkflowStatusStore()
	p.workflowStatus.RecordTick(1, trimmed, "executed")

	synthetic := syntheticWorkflowUserID(trimmed, 1)
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
	p, _ := newRedisBackedWorkflowPlugin(t)
	p.shareStore = NewShareStore(p.logger, NewInMemoryRateLimiter(p.logger))
	orgID := int64(1)
	synthetic := syntheticWorkflowUserID("share-wf", 1)
	if err := p.workflowEntryStore().SaveWorkflows(context.Background(), orgID, []WorkflowEntry{
		{Name: "share-wf", Enabled: true, Skill: "dispatch", ToolAllowlist: []string{"t"}},
	}); err != nil {
		t.Fatalf("workflow store seed failed: %v", err)
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
	p, _ := newRedisBackedWorkflowPlugin(t)
	p.shareStore = NewShareStore(p.logger, NewInMemoryRateLimiter(p.logger))
	orgID := int64(1)
	synthetic := syntheticWorkflowUserID(wfName, 1)
	if err := p.workflowEntryStore().SaveWorkflows(context.Background(), orgID, []WorkflowEntry{
		{Name: wfName, Enabled: true, Skill: "dispatch", ToolAllowlist: []string{"t"}},
	}); err != nil {
		t.Fatalf("workflow store seed failed: %v", err)
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
	p.revokeRemovedWorkflowShares([]WorkflowEntry{{Name: "gone-wf", OrgID: orgID}, {Name: "kept-wf", OrgID: orgID}}, nil)

	hours := 24
	payload := []byte(`{"id":"s","messages":[{"role":"user","content":"x"}]}`)
	goneShare, err := p.shareStore.CreateShare("s-gone", payload, orgID, syntheticWorkflowUserID("gone-wf", orgID), &hours)
	if err != nil {
		t.Fatalf("gone share creation failed: %v", err)
	}
	keptShare, err := p.shareStore.CreateShare("s-kept", payload, orgID, syntheticWorkflowUserID("kept-wf", orgID), &hours)
	if err != nil {
		t.Fatalf("kept share creation failed: %v", err)
	}

	// The next settings load no longer lists gone-wf.
	p.revokeRemovedWorkflowShares([]WorkflowEntry{{Name: "kept-wf", OrgID: orgID}}, nil)

	if _, err := p.shareStore.GetShare(goneShare.ShareID); err == nil {
		t.Fatal("a removed workflow's share must be revoked")
	}
	if _, err := p.shareStore.GetShare(keptShare.ShareID); err != nil {
		t.Fatalf("a configured workflow's share must survive: %v", err)
	}
}

// TestRemovedWorkflowEntryRevokesOnlyItsOrg covers the same workflow name in
// two orgs: removing org 2's entry revokes org 2's synthetic owner's shares
// and leaves org 1's shares untouched.
func TestRemovedWorkflowEntryRevokesOnlyItsOrg(t *testing.T) {
	p := newAgentRunTestPlugin(t)
	p.shareStore = NewShareStore(p.logger, NewInMemoryRateLimiter(p.logger))
	const name = "shared-name"
	const orgA, orgB = int64(1), int64(2)
	hours := 24
	payload := []byte(`{"id":"s","messages":[{"role":"user","content":"x"}]}`)

	// Both orgs applied the same workflow name.
	p.revokeRemovedWorkflowShares([]WorkflowEntry{
		{Name: name, OrgID: orgA},
		{Name: name, OrgID: orgB},
	}, nil)

	shareA, err := p.shareStore.CreateShare("s-a", payload, orgA, syntheticWorkflowUserID(name, orgA), &hours)
	if err != nil {
		t.Fatalf("org A share creation failed: %v", err)
	}
	shareB, err := p.shareStore.CreateShare("s-b", payload, orgB, syntheticWorkflowUserID(name, orgB), &hours)
	if err != nil {
		t.Fatalf("org B share creation failed: %v", err)
	}

	// The next settings load no longer lists the workflow for org B only.
	p.revokeRemovedWorkflowShares([]WorkflowEntry{{Name: name, OrgID: orgA}}, nil)

	if _, err := p.shareStore.GetShare(shareB.ShareID); err == nil {
		t.Fatal("the removed org's share must be revoked")
	}
	if _, err := p.shareStore.GetShare(shareA.ShareID); err != nil {
		t.Fatalf("the other org's share must survive: %v", err)
	}
}

// workflowNamesFromGet returns the names the GET response lists, in order.
func workflowNamesFromGet(t *testing.T, rec *httptest.ResponseRecorder) []string {
	t.Helper()
	var body struct {
		Workflows []struct {
			Name string `json:"name"`
		} `json:"workflows"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("invalid workflows response: %v: %s", err, rec.Body.String())
	}
	names := make([]string, 0, len(body.Workflows))
	for _, entry := range body.Workflows {
		names = append(names, entry.Name)
	}
	return names
}

// The PUT handler stamps the requesting org on every entry and ignores a
// client-supplied orgId; the stored list round-trips through GET.
func TestHandleWorkflowSaveStampsOrgAndRoundTripsThroughGet(t *testing.T) {
	p, _ := newRedisBackedWorkflowPlugin(t)
	body := `{"workflows":[{"name":"saved-wf","orgId":99,"enabled":true,` +
		`"skill":"investigating-alerts","intervalSeconds":300,"sessionTimeoutSeconds":420,` +
		`"toolAllowlist":["t"]}]}`

	rec := putWorkflowsRequest(t, p, 1, "Admin", body)
	if rec.Code != http.StatusOK {
		t.Fatalf("admin save must succeed, got %d: %s", rec.Code, rec.Body.String())
	}
	if names := workflowNamesFromGet(t, rec); len(names) != 1 || names[0] != "saved-wf" {
		t.Fatalf("save response must list the stored entry, got %v", names)
	}

	entries, err := p.workflowEntryStore().ListWorkflows(context.Background(), 1)
	if err != nil || len(entries) != 1 {
		t.Fatalf("org 1 store must hold one entry: %v %+v", err, entries)
	}
	if entries[0].OrgID != 1 {
		t.Fatalf("server must stamp the request org over the client value, got %d", entries[0].OrgID)
	}
	if other, err := p.workflowEntryStore().ListWorkflows(context.Background(), 2); err != nil || len(other) != 0 {
		t.Fatalf("org 2 must stay empty: %v %+v", err, other)
	}

	get := getWorkflowsRequest(t, p, 1, "Admin")
	if get.Code != http.StatusOK {
		t.Fatalf("GET after save must succeed, got %d: %s", get.Code, get.Body.String())
	}
	if names := workflowNamesFromGet(t, get); len(names) != 1 || names[0] != "saved-wf" {
		t.Fatalf("GET must return the saved entry, got %v", names)
	}
}

func TestHandleWorkflowSaveRejectsNonAdmin(t *testing.T) {
	p, client := newRedisBackedWorkflowPlugin(t)
	body := putWorkflowsBody(t, []WorkflowEntry{validStoredWorkflowEntry("viewer-wf")})

	rec := putWorkflowsRequest(t, p, 1, "Viewer", body)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("viewer must be refused, got %d: %s", rec.Code, rec.Body.String())
	}
	if got := workflowStoreSnapshot(t, client, 1); got != "<absent>" {
		t.Fatalf("a refused save must write nothing, store holds %q", got)
	}
}

func TestHandleWorkflowSaveRejectsDuplicateNameWithoutWriting(t *testing.T) {
	p, client := newRedisBackedWorkflowPlugin(t)
	ctx := context.Background()
	if err := p.workflowEntryStore().SaveWorkflows(ctx, 1, []WorkflowEntry{validStoredWorkflowEntry("kept-wf")}); err != nil {
		t.Fatalf("fixture save failed: %v", err)
	}
	before := workflowStoreSnapshot(t, client, 1)

	rec := putWorkflowsRequest(t, p, 1, "Admin",
		putWorkflowsBody(t, []WorkflowEntry{validStoredWorkflowEntry("dup-wf"), validStoredWorkflowEntry("dup-wf")}))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("duplicate name must be refused, got %d: %s", rec.Code, rec.Body.String())
	}
	var body struct {
		Errors []struct {
			Name  string `json:"name"`
			Error string `json:"error"`
		} `json:"errors"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("invalid error body: %v: %s", err, rec.Body.String())
	}
	if len(body.Errors) != 1 || body.Errors[0].Name != "dup-wf" || body.Errors[0].Error == "" {
		t.Fatalf("expected one named duplicate error, got %+v", body.Errors)
	}

	if after := workflowStoreSnapshot(t, client, 1); after != before {
		t.Fatalf("a failed save must leave the store byte-identical:\nbefore %q\nafter  %q", before, after)
	}
}

func TestHandleWorkflowSaveRejectsTooManyEntries(t *testing.T) {
	p, client := newRedisBackedWorkflowPlugin(t)
	if err := p.workflowEntryStore().SaveWorkflows(context.Background(), 1, []WorkflowEntry{validStoredWorkflowEntry("kept-wf")}); err != nil {
		t.Fatalf("fixture save failed: %v", err)
	}
	before := workflowStoreSnapshot(t, client, 1)

	entries := make([]WorkflowEntry, 0, maxWorkflowEntriesPerOrg+1)
	for i := 0; i < maxWorkflowEntriesPerOrg+1; i++ {
		entries = append(entries, validStoredWorkflowEntry(fmt.Sprintf("wf-%d", i)))
	}
	rec := putWorkflowsRequest(t, p, 1, "Admin", putWorkflowsBody(t, entries))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("over the entry cap must be refused, got %d: %s", rec.Code, rec.Body.String())
	}
	var body struct {
		Errors []map[string]string `json:"errors"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil || len(body.Errors) == 0 {
		t.Fatalf("expected an errors body, got %v: %s", err, rec.Body.String())
	}
	if after := workflowStoreSnapshot(t, client, 1); after != before {
		t.Fatalf("a refused save must leave the store byte-identical:\nbefore %q\nafter  %q", before, after)
	}
}

func TestHandleWorkflowSaveRejectsOversizeBody(t *testing.T) {
	p, client := newRedisBackedWorkflowPlugin(t)
	entry := validStoredWorkflowEntry("big-wf")
	entry.Message = strings.Repeat("x", maxWorkflowSaveBodyBytes)

	rec := putWorkflowsRequest(t, p, 1, "Admin", putWorkflowsBody(t, []WorkflowEntry{entry}))
	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("a body over the cap must be 413, got %d: %s", rec.Code, rec.Body.String())
	}
	if got := workflowStoreSnapshot(t, client, 1); got != "<absent>" {
		t.Fatalf("an oversize body must write nothing, store holds %q", got)
	}
}

// Without Redis both routes fail closed: GET is 503, not an empty list, and
// PUT is 503, not a silent success.
func TestWorkflowRoutesFailClosedWithoutRedis(t *testing.T) {
	p := newAgentRunTestPlugin(t) // no redisClient, matching the no-Redis deployment

	get := getWorkflowsRequest(t, p, 1, "Admin")
	if get.Code != http.StatusServiceUnavailable {
		t.Fatalf("GET without Redis must be 503, got %d: %s", get.Code, get.Body.String())
	}
	if !strings.Contains(get.Body.String(), "error") {
		t.Fatalf("GET failure must be a JSON error body, got %s", get.Body.String())
	}

	put := putWorkflowsRequest(t, p, 1, "Admin",
		putWorkflowsBody(t, []WorkflowEntry{validStoredWorkflowEntry("no-redis-wf")}))
	if put.Code != http.StatusServiceUnavailable {
		t.Fatalf("PUT without Redis must be 503, got %d: %s", put.Code, put.Body.String())
	}
	if !strings.Contains(put.Body.String(), "error") {
		t.Fatalf("PUT failure must be a JSON error body, got %s", put.Body.String())
	}
}

// Two orgs save independently, and each GET sees only its own entries.
func TestWorkflowsListIsolatesOrgs(t *testing.T) {
	p, _ := newRedisBackedWorkflowPlugin(t)

	if rec := putWorkflowsRequest(t, p, 1, "Admin",
		putWorkflowsBody(t, []WorkflowEntry{validStoredWorkflowEntry("org-one-wf")})); rec.Code != http.StatusOK {
		t.Fatalf("org 1 save failed: %d %s", rec.Code, rec.Body.String())
	}
	if rec := putWorkflowsRequest(t, p, 2, "Admin",
		putWorkflowsBody(t, []WorkflowEntry{validStoredWorkflowEntry("org-two-wf")})); rec.Code != http.StatusOK {
		t.Fatalf("org 2 save failed: %d %s", rec.Code, rec.Body.String())
	}

	one := getWorkflowsRequest(t, p, 1, "Admin")
	if one.Code != http.StatusOK {
		t.Fatalf("org 1 GET failed: %d %s", one.Code, one.Body.String())
	}
	if names := workflowNamesFromGet(t, one); len(names) != 1 || names[0] != "org-one-wf" {
		t.Fatalf("org 1 must see only its own entry, got %v", names)
	}

	two := getWorkflowsRequest(t, p, 2, "Admin")
	if two.Code != http.StatusOK {
		t.Fatalf("org 2 GET failed: %d %s", two.Code, two.Body.String())
	}
	if names := workflowNamesFromGet(t, two); len(names) != 1 || names[0] != "org-two-wf" {
		t.Fatalf("org 2 must see only its own entry, got %v", names)
	}
}

// A successful PUT starts the entry's scheduler on the live manager: the save
// is the hot-apply seam, with no NewPlugin and no Dispose. A second save that
// drops the entry stops it.
func TestHandleWorkflowSaveHotAppliesScheduler(t *testing.T) {
	p, _ := newRedisBackedWorkflowPlugin(t)
	manager := p.workflows
	const name = "hot-apply-wf"

	if p.workflows.isRunning(1, name) {
		t.Fatal("no scheduler may run before the save")
	}

	rec := putWorkflowsRequest(t, p, 1, "Admin",
		putWorkflowsBody(t, []WorkflowEntry{validStoredWorkflowEntry(name)}))
	if rec.Code != http.StatusOK {
		t.Fatalf("save failed: %d %s", rec.Code, rec.Body.String())
	}
	if p.workflows != manager {
		t.Fatal("a save must hot-apply on the live manager, not rebuild the instance")
	}
	if !p.workflows.isRunning(1, name) {
		t.Fatal("the saved entry must start its scheduler immediately")
	}

	rec = putWorkflowsRequest(t, p, 1, "Admin", putWorkflowsBody(t, nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("removal save failed: %d %s", rec.Code, rec.Body.String())
	}
	if p.workflows.schedulerFor(1, name) != nil {
		t.Fatal("dropping the entry through the route must stop its scheduler")
	}
}

// The runs and share routes resolve the workflow from the requesting org's
// store: a name stored by another org is a 404, and the owning org gets 200.
func TestWorkflowRoutesResolveEntriesFromRequestingOrgStore(t *testing.T) {
	p, _ := newRedisBackedWorkflowPlugin(t)
	ctx := context.Background()
	const name = "org-two-only-wf"
	const orgID = int64(2)

	if err := p.workflowEntryStore().SaveWorkflows(ctx, orgID, []WorkflowEntry{
		{Name: name, Enabled: true, Skill: "dispatch", ToolAllowlist: []string{"t"}},
	}); err != nil {
		t.Fatalf("org 2 store seed failed: %v", err)
	}

	synthetic := syntheticWorkflowUserID(name, orgID)
	session, err := p.sessionStore.CreateSession(synthetic, orgID, "Workflow "+name+": dispatch",
		[]SessionMessage{{Role: "user", Content: "go"}})
	if err != nil {
		t.Fatalf("session creation failed: %v", err)
	}
	convType := workflowConversationType
	workflowName := name
	if err := p.sessionStore.UpdateSession(session.ID, synthetic, orgID, SessionUpdate{
		ConversationType: &convType, Workflow: &workflowName,
	}); err != nil {
		t.Fatalf("session tagging failed: %v", err)
	}
	const runID = "org2-run-1"
	p.runStore.CreateRun(runID, synthetic, orgID, session.ID)
	p.runStore.FinishRun(runID, RunStatusCompleted, "")

	runsReq := func(requestOrg int64) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodGet, "/api/workflows/"+name+"/runs?limit=10", nil)
		req = withTestIdentity(req, requestOrg, "admin-1", "Admin")
		rec := httptest.NewRecorder()
		p.handleWorkflowRuns(rec, req)
		return rec
	}
	shareReq := func(requestOrg int64) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, "/api/workflows/"+name+"/runs/"+runID+"/share", nil)
		req = withTestIdentity(req, requestOrg, "admin-1", "Admin")
		rec := httptest.NewRecorder()
		p.handleWorkflowRuns(rec, req)
		return rec
	}

	// Org 1 never stored the name: both routes refuse it.
	if rec := runsReq(1); rec.Code != http.StatusNotFound {
		t.Fatalf("org 1 runs must 404 for a name absent from its store, got %d", rec.Code)
	}
	if rec := shareReq(1); rec.Code != http.StatusNotFound {
		t.Fatalf("org 1 share must 404 for a name absent from its store, got %d", rec.Code)
	}

	// The owning org sees the entry and its run.
	rec := runsReq(orgID)
	if rec.Code != http.StatusOK {
		t.Fatalf("org 2 runs must succeed from its store, got %d: %s", rec.Code, rec.Body.String())
	}
	var runsBody struct {
		Workflow string `json:"workflow"`
		Runs     []struct {
			RunID string `json:"runId"`
		} `json:"runs"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &runsBody); err != nil {
		t.Fatalf("invalid runs body: %v", err)
	}
	if runsBody.Workflow != name || len(runsBody.Runs) != 1 || runsBody.Runs[0].RunID != runID {
		t.Fatalf("org 2 must list its run, got %+v", runsBody)
	}
	if rec := shareReq(orgID); rec.Code != http.StatusOK {
		t.Fatalf("org 2 share must succeed from its store, got %d: %s", rec.Code, rec.Body.String())
	}
}
