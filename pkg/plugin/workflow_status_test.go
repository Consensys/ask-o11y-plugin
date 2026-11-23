package plugin

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

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
