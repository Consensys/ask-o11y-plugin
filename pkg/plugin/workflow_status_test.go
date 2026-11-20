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
			Name: "running-wf", Enabled: true, OrgID: 1, Skill: "dispatch",
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
	p.workflowStatus.RecordSession("running-wf", "started")
	p.workflowStatus.RecordSession("running-wf", "completed")

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
	if status["lastTickOutcome"] != "executed" || status["completed"].(float64) != 1 {
		t.Fatalf("status not joined: %v", status)
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
