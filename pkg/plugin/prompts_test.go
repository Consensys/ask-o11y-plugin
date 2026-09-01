package plugin

import (
	"strings"
	"testing"
)

func TestBuildSystemPrompt_InvestigationAppendsAddendum(t *testing.T) {
	r, err := NewPromptRegistry(PluginSettings{})
	if err != nil {
		t.Fatal(err)
	}
	base, err := r.BuildSystemPrompt(BuildToolContext("Org1", "Admin"))
	if err != nil {
		t.Fatal(err)
	}
	ctx := BuildToolContext("Org1", "Admin")
	ctx.ConversationType = "investigation"
	ctx.IsAlertInvestigation = true
	withAdd, err := r.BuildSystemPrompt(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(withAdd, DefaultInvestigationModeSystemAddendum) {
		t.Fatal("expected investigation system addendum in prompt")
	}
	if len(withAdd) <= len(base) {
		t.Fatalf("investigation prompt should be longer than base; base=%d with=%d", len(base), len(withAdd))
	}
}

// TestBuildSystemPrompt_FiringMessageInChatAppendsAddendum guards against the
// Sept 2026 production incident: a user pasted a raw "[FIRING:1] ..." alert
// notification into plain chat (reqType "chat", not the "investigation" deep
// link), which got the bigger AlertInvestigationMaxIter budget via
// isAlertInvestigation but not these efficiency guardrails, because the two
// were gated on different conditions. IsAlertInvestigation must now be
// computed from the same helper for both, so this case gets the addendum too.
func TestBuildSystemPrompt_FiringMessageInChatAppendsAddendum(t *testing.T) {
	r, err := NewPromptRegistry(PluginSettings{})
	if err != nil {
		t.Fatal(err)
	}
	ctx := BuildToolContext("Org1", "Admin")
	ctx.ConversationType = "chat"
	ctx.IsAlertInvestigation = isAlertInvestigation("chat", "Prometheus]: [FIRING:1] mmcx-prd alb P2 (SecurityAlertsApiTrafficNearZero prd mmcx noc)")
	out, err := r.BuildSystemPrompt(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, DefaultInvestigationModeSystemAddendum) {
		t.Fatal("expected investigation system addendum for a firing-alert message pasted into plain chat")
	}
}

func TestBuildSystemPrompt_AntiHallucinationContractAlwaysPresent(t *testing.T) {
	r, err := NewPromptRegistry(PluginSettings{})
	if err != nil {
		t.Fatal(err)
	}
	out, err := r.BuildSystemPrompt(BuildToolContext("Org1", "Viewer"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, "Anti-Hallucination Contract") {
		t.Fatal("expected Anti-Hallucination Contract section in base prompt")
	}
	if !strings.Contains(out, "MCP transport failure") {
		t.Fatal("expected transport-failure directive in prompt")
	}
}

func TestBuildSystemPrompt_FeedbackGuardrailsPresent(t *testing.T) {
	r, err := NewPromptRegistry(PluginSettings{})
	if err != nil {
		t.Fatal(err)
	}
	out, err := r.BuildSystemPrompt(BuildToolContext("Org1", "Editor"))
	if err != nil {
		t.Fatal(err)
	}

	cases := []struct {
		name    string
		snippet string
	}{
		{"no unprompted writes", "Write Actions Require Explicit Intent"},
		{"capability honesty", "Capability honesty"},
		{"honor user time range", "Honor the user's time range exactly"},
	}
	for _, tc := range cases {
		if !strings.Contains(out, tc.snippet) {
			t.Errorf("expected %q guardrail (%q) in system prompt", tc.name, tc.snippet)
		}
	}
}

func TestBuildSystemPrompt_DatasourceSnapshotSlot(t *testing.T) {
	r, err := NewPromptRegistry(PluginSettings{})
	if err != nil {
		t.Fatal(err)
	}

	// Without snapshot -> no "Known Datasource UIDs" block.
	blank, err := r.BuildSystemPrompt(BuildToolContext("Org1", "Admin"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(blank, "Known Datasource UIDs (this run)") {
		t.Fatal("empty DatasourceSnapshot should not render the UIDs block")
	}

	// With snapshot -> block rendered verbatim.
	ctx := BuildToolContext("Org1", "Admin")
	ctx.DatasourceSnapshot = "- prometheus (mimir): uid=abc123\n- loki (loki-prod): uid=def456"
	withSnap, err := r.BuildSystemPrompt(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(withSnap, "Known Datasource UIDs (this run)") {
		t.Fatal("expected Known Datasource UIDs block when snapshot is set")
	}
	if !strings.Contains(withSnap, "uid=abc123") || !strings.Contains(withSnap, "uid=def456") {
		t.Fatal("expected snapshot UIDs rendered inside the block")
	}
}
