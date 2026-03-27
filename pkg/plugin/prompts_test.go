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
