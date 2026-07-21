package plugin

import (
	"consensys-asko11y-app/pkg/agent"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestScoreAgentRunRewardsEvidenceAndFinalReport(t *testing.T) {
	run := &AgentRun{
		RunID:  "run-1",
		Status: RunStatusCompleted,
		Trace: &AgentRunTrace{
			Evidence: []agent.EvidenceEvent{
				{ID: "e1", Summary: "metric evidence"},
				{ID: "e2", Summary: "trace evidence"},
			},
			FinalReport: &agent.FinalReportEvent{
				Summary:     strings.Repeat("word ", 45),
				Confidence:  "high",
				EvidenceIDs: []string{"e1", "e2"},
				NextSteps:   []string{"watch error rate"},
			},
		},
	}

	result := scoreAgentRun(run)

	if result.Scores.EvidenceCoverage != 70 {
		t.Fatalf("evidence score = %d, want 70", result.Scores.EvidenceCoverage)
	}
	if result.Scores.FinalReportCompleteness < 80 {
		t.Fatalf("final report score = %d, want >= 80", result.Scores.FinalReportCompleteness)
	}
	if result.Scores.HallucinationRisk >= 50 {
		t.Fatalf("hallucination risk = %d, want < 50", result.Scores.HallucinationRisk)
	}
}

func TestHandleAgentEvalsReturnsRecentRunScores(t *testing.T) {
	p := newAgentRunTestPlugin(t)
	p.settings.AgentEvalCaptureEnabled = true
	p.runStore.CreateRun("run-1", 7, 2)
	p.runStore.AppendEvent("run-1", agent.SSEEvent{Type: "evidence", Data: agent.EvidenceEvent{
		ID:      "e1",
		Title:   "Prometheus",
		Summary: "up == 1",
	}})
	p.runStore.AppendEvent("run-1", agent.SSEEvent{Type: "final_report", Data: agent.FinalReportEvent{
		Summary: "The service recovered after deployment rollback.",
	}})
	p.runStore.FinishRun("run-1", RunStatusCompleted, "")

	req := httptest.NewRequest(http.MethodGet, "/api/agent/evals", nil)
	req.Header.Set("X-Grafana-Org-Id", "2")
	req.Header.Set("X-Grafana-User-Id", "7")
	rec := httptest.NewRecorder()

	p.handleAgentEvals(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", rec.Code, rec.Body.String())
	}
	var body struct {
		Enabled bool              `json:"enabled"`
		Evals   []AgentEvalResult `json:"evals"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !body.Enabled || len(body.Evals) != 1 {
		t.Fatalf("unexpected body: %+v", body)
	}
	if body.Evals[0].RunID != "run-1" || body.Evals[0].EvidenceCount != 1 {
		t.Fatalf("unexpected eval result: %+v", body.Evals[0])
	}
}

func TestHandleAgentEvalRunRequiresEditorOrAdmin(t *testing.T) {
	p := newAgentRunTestPlugin(t)
	p.settings.AgentEvalCaptureEnabled = true

	req := httptest.NewRequest(http.MethodPost, "/api/agent/evals/run", strings.NewReader(`{}`))
	req.Header.Set("X-Grafana-Org-Id", "2")
	req.Header.Set("X-Grafana-User-Id", "7")
	req.Header.Set("X-Grafana-User-Role", "Viewer")
	rec := httptest.NewRecorder()

	p.handleAgentEvalRun(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", rec.Code)
	}
}
