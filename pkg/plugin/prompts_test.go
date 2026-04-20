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
