package skills

import (
	"strings"
	"testing"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
)

const validSkillMD = `---
name: testing-things
description: Tests things thoroughly. Use when the user asks to test things.
metadata:
  model: large
  max-iterations: "42"
  triggers: 'test things|run tests'
  version: "1.2"
  user-prompt: |
    Test the thing "{{.Target}}" now.
---

## Testing workflow

1. Do the thing
2. Report for org {{.OrgName}}
`

func TestParse_ValidSkill(t *testing.T) {
	s, err := Parse(validSkillMD)
	if err != nil {
		t.Fatal(err)
	}
	if s.Name != "testing-things" {
		t.Errorf("name = %q", s.Name)
	}
	if s.Model != "large" {
		t.Errorf("model = %q", s.Model)
	}
	if s.MaxIterations != 42 {
		t.Errorf("max-iterations = %d", s.MaxIterations)
	}
	if s.Visibility != VisibilityPublic {
		t.Errorf("visibility = %q", s.Visibility)
	}
	if !s.MatchesTrigger("please TEST THINGS now") {
		t.Error("trigger must match case-insensitively")
	}
	if s.MatchesTrigger("unrelated message") {
		t.Error("trigger must not match unrelated messages")
	}

	body, err := s.RenderBody(map[string]string{"OrgName": "Org7"})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(body, "Report for org Org7") {
		t.Errorf("body template not rendered: %s", body)
	}

	prompt, err := s.RenderUserPrompt(map[string]string{"Target": "widget"})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(prompt, `Test the thing "widget" now.`) {
		t.Errorf("user-prompt not rendered: %s", prompt)
	}
}

func TestParse_RejectsInvalidInput(t *testing.T) {
	cases := []struct {
		name    string
		content string
		wantErr string
	}{
		{"no frontmatter", "# Just markdown", "frontmatter"},
		{"unclosed frontmatter", "---\nname: x\n", "not closed"},
		{"missing name", "---\ndescription: d\n---\nbody", "'name' is required"},
		{"uppercase name", "---\nname: BadName\ndescription: d\n---\n", "invalid skill name"},
		{"consecutive hyphens", "---\nname: bad--name\ndescription: d\n---\n", "invalid skill name"},
		{"missing description", "---\nname: ok-name\n---\nbody", "'description' is required"},
		{"invalid visibility", "---\nname: ok-name\ndescription: d\nmetadata:\n  visibility: secret\n---\n", "invalid visibility"},
		{"invalid model", "---\nname: ok-name\ndescription: d\nmetadata:\n  model: huge\n---\n", "invalid model"},
		{"invalid max-iterations", "---\nname: ok-name\ndescription: d\nmetadata:\n  max-iterations: \"0\"\n---\n", "max-iterations"},
		{"invalid triggers regex", "---\nname: ok-name\ndescription: d\nmetadata:\n  triggers: '[unclosed'\n---\n", "triggers"},
		{"blocked template action", "---\nname: ok-name\ndescription: d\n---\n{{call .X}}", "forbidden template action"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := Parse(tc.content)
			if err == nil || !strings.Contains(err.Error(), tc.wantErr) {
				t.Fatalf("expected error containing %q, got: %v", tc.wantErr, err)
			}
		})
	}
}

func TestBundledSkillsAllParse(t *testing.T) {
	// Guard for loadBundled's "build-time bug" error path: every shipped
	// skill must parse and match its directory name.
	bundled, refs := loadBundled(log.DefaultLogger)
	if len(bundled) == 0 {
		t.Fatal("no bundled skills found")
	}
	expected := []string{
		"analyzing-cloudwatch",
		"analyzing-performance",
		"analyzing-traces",
		"building-dashboards",
		"investigating-alerts",
		"querying-profiles",
		"rendering-visualizations",
		"writing-promql-and-logql",
	}
	if len(bundled) != len(expected) {
		t.Fatalf("expected %d bundled skills, got %d: %+v", len(expected), len(bundled), bundled)
	}
	for _, name := range expected {
		found := false
		for _, s := range bundled {
			if s.Name == name {
				found = true
				if s.Source != "" {
					t.Errorf("loadBundled must not set source; %s has %q", name, s.Source)
				}
				break
			}
		}
		if !found {
			t.Errorf("missing bundled skill %q", name)
		}
	}
	if len(refs["writing-promql-and-logql"]) != 2 {
		t.Errorf("expected 2 reference files for writing-promql-and-logql, got %v", refs["writing-promql-and-logql"])
	}
}

func TestRegistry_CustomAndOverrideAndDisable(t *testing.T) {
	disabled := false
	settings := Settings{Entries: map[string]Entry{
		"my-custom-skill": {Content: "---\nname: my-custom-skill\ndescription: Does custom things.\n---\nBody"},
		"investigating-alerts": {Content: "---\nname: investigating-alerts\ndescription: Overridden.\nmetadata:\n  model: base\n---\nOverridden body"},
		"analyzing-traces": {Enabled: &disabled},
	}}

	r := NewRegistry(settings, log.DefaultLogger)

	if s, ok := r.Get("my-custom-skill"); !ok || s.Source != SourceCustom {
		t.Fatal("custom skill must be active with source custom")
	}
	s, ok := r.Get("investigating-alerts")
	if !ok {
		t.Fatal("overridden bundled skill must stay active")
	}
	if !s.Customized || s.Source != SourceBundled || s.Model != "base" || s.Body != "Overridden body" {
		t.Fatalf("override not applied: %+v", s)
	}
	if refs := s.References; len(refs) != 0 {
		// investigating-alerts has no references; the override must not lose any.
		t.Fatalf("expected no references for investigating-alerts, got %v", refs)
	}
	if _, ok := r.Get("analyzing-traces"); ok {
		t.Fatal("pure disable entry must remove the bundled skill")
	}

	var traceInfo *Info
	for _, info := range r.Infos() {
		if info.Name == "analyzing-traces" && traceInfo == nil {
			copy := info
			traceInfo = &copy
		}
	}
	if traceInfo == nil || traceInfo.Enabled || traceInfo.Source != SourceBundled {
		t.Fatalf("disabled bundled skill must be listed as disabled: %+v", traceInfo)
	}
}

func TestRegistry_InvalidEntriesSurfaceInInfos(t *testing.T) {
	r := NewRegistry(Settings{Entries: map[string]Entry{
		"broken": {Content: "not a skill"},
		"mismatched": {Content: "---\nname: other-name\ndescription: d\n---\nbody"},
	}}, log.DefaultLogger)

	if _, ok := r.Get("broken"); ok {
		t.Fatal("invalid skill must not be active")
	}
	infos := r.Infos()
	var broken, mismatched bool
	for _, info := range infos {
		switch info.Name {
		case "broken":
			broken = info.Invalid && strings.Contains(info.InvalidReason, "frontmatter")
		case "mismatched":
			mismatched = info.Invalid && strings.Contains(info.InvalidReason, "must match")
		}
	}
	if !broken || !mismatched {
		t.Fatalf("invalid entries must surface reasons, infos: %+v", infos)
	}
}

func TestRegistry_Load(t *testing.T) {
	r := NewRegistry(Settings{}, log.DefaultLogger)

	body, err := r.Load("writing-promql-and-logql", "", map[string]string{})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(body, "PromQL") {
		t.Fatalf("expected skill body, got: %.80s", body)
	}

	ref, err := r.Load("writing-promql-and-logql", "references/logql.md", nil)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(ref, "Label discovery workflow") {
		t.Fatalf("expected logql reference, got: %.80s", ref)
	}

	if _, err := r.Load("no-such-skill", "", nil); err == nil {
		t.Fatal("unknown skill must error")
	}
	if _, err := r.Load("writing-promql-and-logql", "references/missing.md", nil); err == nil {
		t.Fatal("missing reference must error")
	}
}

func TestResolve_ExplicitTypeAndTrigger(t *testing.T) {
	r := NewRegistry(Settings{}, log.DefaultLogger)

	// Explicit request of an unknown skill is a caller error.
	if _, err := Resolve(r, "hi", []string{"no-such-skill"}, "chat"); err == nil {
		t.Fatal("unknown requested skill must error")
	}

	// Legacy type mapping activates the skill and sets its user-prompt.
	act, err := Resolve(r, "alertName:X", nil, "investigation")
	if err != nil {
		t.Fatal(err)
	}
	if !HasActive(act, "investigating-alerts") || act.UserPromptSkill == nil {
		t.Fatal("investigation type must map to investigating-alerts with a user prompt")
	}
	if IterationBudget(act) != 60 || ModelPreference(act) != "large" {
		t.Fatalf("investigating-alerts metadata not applied: iter=%d model=%s", IterationBudget(act), ModelPreference(act))
	}

	// Trigger activation injects the body but keeps the message verbatim.
	act, err = Resolve(r, "Prometheus]: [FIRING:1] thing", nil, "chat")
	if err != nil {
		t.Fatal(err)
	}
	if !HasActive(act, "investigating-alerts") {
		t.Fatal("firing pattern must trigger investigating-alerts")
	}
	if act.UserPromptSkill != nil {
		t.Fatal("trigger activation must not wrap the user message")
	}

	// Picker selection: explicit, no user-prompt wrapping.
	act, err = Resolve(r, "help me", []string{"querying-profiles"}, "chat")
	if err != nil {
		t.Fatal(err)
	}
	if !HasActive(act, "querying-profiles") || act.UserPromptSkill != nil {
		t.Fatal("explicit skill selection must activate without user-prompt wrapping")
	}

	// No skills and no trigger: empty activation.
	act, err = Resolve(r, "hello there", nil, "chat")
	if err != nil {
		t.Fatal(err)
	}
	if len(act.Skills) != 0 || IterationBudget(act) != 0 || ModelPreference(act) != "" {
		t.Fatalf("plain chat must resolve to an empty activation: %+v", act)
	}
}

func TestResolve_DisabledMappedSkillDoesNotBreakLegacyType(t *testing.T) {
	disabled := false
	r := NewRegistry(Settings{Entries: map[string]Entry{
		"investigating-alerts": {Enabled: &disabled},
	}}, log.DefaultLogger)

	act, err := Resolve(r, "alertName:X", nil, "investigation")
	if err != nil {
		t.Fatalf("legacy deep-link type must never error, got: %v", err)
	}
	if HasActive(act, "investigating-alerts") {
		t.Fatal("disabled skill must not activate")
	}
}

func TestRegistry_HasEntryAndBundledUserPrompt(t *testing.T) {
	disabled := false
	enabled := true
	r := NewRegistry(Settings{Entries: map[string]Entry{
		"investigating-alerts": {Enabled: &disabled},
		"analyzing-performance": {Content: "---\nname: analyzing-performance\ndescription: d\nmetadata:\n  user-prompt: |\n    Custom {{.Target}}\n---\nbody", Enabled: &enabled},
	}}, log.DefaultLogger)

	if !r.HasEntry("investigating-alerts") || !r.HasEntry("analyzing-performance") {
		t.Fatal("HasEntry must report any admin-managed entry")
	}
	if r.HasEntry("building-dashboards") {
		t.Fatal("HasEntry must not report unmanaged bundled skills")
	}

	// Bundled defaults survive enable/disable state for stable prompt-defaults keys.
	if _, ok := r.Get("investigating-alerts"); ok {
		t.Fatal("investigating-alerts should be disabled")
	}
	if got := r.BundledUserPrompt("investigating-alerts"); got == "" || !strings.Contains(got, "{{.AlertName}}") {
		t.Fatalf("BundledUserPrompt must return the shipped template for a disabled skill, got: %.60s", got)
	}
	if got := r.BundledUserPrompt("no-such-skill"); got != "" {
		t.Fatalf("BundledUserPrompt for unknown skill must be empty, got: %.60s", got)
	}
}

func TestRegistry_PublicInfosExcludesHidden(t *testing.T) {
	r := NewRegistry(Settings{Entries: map[string]Entry{
		"internal-hidden-skill": {Content: "---\nname: internal-hidden-skill\ndescription: d\nmetadata:\n  visibility: hidden\n---\nbody"},
	}}, log.DefaultLogger)

	public := r.PublicInfos()
	for _, info := range public {
		if info.Hidden {
			t.Fatalf("PublicInfos must exclude hidden skills, got %q", info.Name)
		}
	}
	all := r.Infos()
	hiddenFound := false
	for _, info := range all {
		if info.Name == "internal-hidden-skill" && info.Hidden {
			hiddenFound = true
		}
	}
	if !hiddenFound {
		t.Fatal("Infos (admin view) must still list hidden skills for management")
	}
}
