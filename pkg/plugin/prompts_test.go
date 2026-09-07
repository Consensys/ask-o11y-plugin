package plugin

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"consensys-asko11y-app/pkg/skills"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
)

func newTestSkillRegistry(t *testing.T) *skills.Registry {
	t.Helper()
	return skills.NewRegistry(skills.Settings{}, log.DefaultLogger)
}

func TestBuildSystemPrompt_InvestigationSkillBodyInjected(t *testing.T) {
	r, err := NewPromptRegistry(PluginSettings{})
	if err != nil {
		t.Fatal(err)
	}
	reg := newTestSkillRegistry(t)

	act, err := skills.Resolve(reg, "alertName:HighErrorRate", nil, "investigation")
	if err != nil {
		t.Fatal(err)
	}
	if !skills.HasActive(act, "investigating-alerts") {
		t.Fatal("legacy investigation type must activate the investigating-alerts skill")
	}

	base, err := r.BuildSystemPrompt(BuildToolContext("Org1", "Admin"))
	if err != nil {
		t.Fatal(err)
	}
	ctx := BuildToolContext("Org1", "Admin")
	ctx.ActiveSkills = act.Skills
	ctx.UserPromptSkill = act.UserPromptSkill
	withSkill, err := r.BuildSystemPrompt(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(withSkill, "Investigation discipline (this request)") {
		t.Fatal("expected investigation guardrails from the skill body in the prompt")
	}
	if !strings.Contains(withSkill, "runbook") {
		t.Fatal("expected runbook-ordering guardrail in the prompt")
	}
	if len(withSkill) <= len(base) {
		t.Fatalf("investigation prompt should be longer than base; base=%d with=%d", len(base), len(withSkill))
	}
}

// TestBuildSystemPrompt_FiringMessageInChatActivatesSkill guards against the
// Sept 2026 production incident: a user pasted a raw "[FIRING:1] ..." alert
// notification into plain chat (reqType "chat", not the "investigation" deep
// link), which got the bigger iteration budget via isAlertInvestigation but
// not the efficiency guardrails, because the two were gated on different
// conditions. The skill trigger regex now drives both the budget (via
// IterationBudget) and the body injection from the same activation.
func TestBuildSystemPrompt_FiringMessageInChatActivatesSkill(t *testing.T) {
	r, err := NewPromptRegistry(PluginSettings{})
	if err != nil {
		t.Fatal(err)
	}
	reg := newTestSkillRegistry(t)

	act, err := skills.Resolve(reg, "Prometheus]: [FIRING:1] mmcx-prd alb P2 (SecurityAlertsApiTrafficNearZero prd mmcx noc)", nil, "chat")
	if err != nil {
		t.Fatal(err)
	}
	if !skills.HasActive(act, "investigating-alerts") {
		t.Fatal("a pasted firing-alert notification must trigger-activate investigating-alerts in plain chat")
	}
	if skills.IterationBudget(act) != 60 {
		t.Fatalf("trigger activation must carry the 60-iteration budget, got %d", skills.IterationBudget(act))
	}

	ctx := BuildToolContext("Org1", "Admin")
	ctx.ActiveSkills = act.Skills
	out, err := r.BuildSystemPrompt(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, "Investigation discipline (this request)") {
		t.Fatal("expected investigation guardrails for a firing-alert message pasted into plain chat")
	}
}

func TestBuildSystemPrompt_CatalogAdvertisesLoadableSkills(t *testing.T) {
	r, err := NewPromptRegistry(PluginSettings{})
	if err != nil {
		t.Fatal(err)
	}
	reg := newTestSkillRegistry(t)

	ctx := BuildToolContext("Org1", "Viewer")
	ctx.SkillsCatalog = reg.Catalog()
	out, err := r.BuildSystemPrompt(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, "## Available skills") || !strings.Contains(out, "load_skill") {
		t.Fatal("expected an Available skills catalog advertising load_skill")
	}
	if !strings.Contains(out, "investigating-alerts") {
		t.Fatal("expected bundled skills in the catalog")
	}

	// Active skills are excluded from the catalog — their bodies are already
	// injected, so re-loading them would waste an iteration.
	act, err := skills.Resolve(reg, "alertName:HighErrorRate", nil, "investigation")
	if err != nil {
		t.Fatal(err)
	}
	ctx.ActiveSkills = act.Skills
	ctx.SkillsCatalog = reg.Catalog(skills.ActiveNames(act)...)
	out, err = r.BuildSystemPrompt(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(out, "- **investigating-alerts**:") {
		t.Fatal("active skill must not appear in the loadable catalog")
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

// TestBuildSystemPrompt_CurrentTimeSlot guards the current-time injection:
// BuildToolContext always stamps the run start time so the agent anchors
// relative windows without a time-tool round-trip, and a zero-value context
// (custom builders) falls back to the legacy "time tool" wording instead of
// rendering an empty block.
func TestBuildSystemPrompt_CurrentTimeSlot(t *testing.T) {
	r, err := NewPromptRegistry(PluginSettings{})
	if err != nil {
		t.Fatal(err)
	}

	out, err := r.BuildSystemPrompt(BuildToolContext("Org1", "Admin"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, "**Current time:") {
		t.Fatal("BuildToolContext should render the Current time block")
	}
	if !strings.Contains(out, "RFC3339:") {
		t.Fatal("Current time block should include an RFC3339 anchor")
	}
	if strings.Contains(out, "establish the real current time using the time tool") {
		t.Fatal("fallback wording must disappear when CurrentTime is set")
	}

	blank, err := r.BuildSystemPrompt(PromptContext{})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(blank, "**Current time:") {
		t.Fatal("empty CurrentTime should not render the block")
	}
	if !strings.Contains(blank, "establish the real current time using the time tool") {
		t.Fatal("empty CurrentTime should fall back to the legacy time-tool wording")
	}
}

func TestBuildUserPrompt_LegacyTypeRendersSkillTemplate(t *testing.T) {
	r, err := NewPromptRegistry(PluginSettings{})
	if err != nil {
		t.Fatal(err)
	}
	reg := newTestSkillRegistry(t)

	act, err := skills.Resolve(reg, "alertName:HighErrorRate", nil, "investigation")
	if err != nil {
		t.Fatal(err)
	}
	ctx := BuildToolContext("Org1", "Admin")
	ctx.UserPromptSkill = act.UserPromptSkill
	out, err := r.BuildUserPrompt("investigation", "alertName:HighErrorRate", ctx)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, `Investigate the alert "HighErrorRate"`) {
		t.Fatalf("expected the skill user-prompt template rendered with the alert name, got: %s", out)
	}
	if strings.Contains(out, "{{") {
		t.Fatal("unrendered template variable in user prompt")
	}

	act, err = skills.Resolve(reg, "api-gateway latency", nil, "performance")
	if err != nil {
		t.Fatal(err)
	}
	ctx = BuildToolContext("Org1", "Admin")
	ctx.UserPromptSkill = act.UserPromptSkill
	out, err = r.BuildUserPrompt("performance", "api-gateway latency", ctx)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, `Analyze performance issues in the system "api-gateway latency"`) {
		t.Fatalf("expected the performance skill user-prompt template, got: %s", out)
	}
}

func TestBuildUserPrompt_ChatPassesMessageVerbatim(t *testing.T) {
	r, err := NewPromptRegistry(PluginSettings{})
	if err != nil {
		t.Fatal(err)
	}
	out, err := r.BuildUserPrompt("chat", "show me CPU usage", BuildToolContext("Org1", "Admin"))
	if err != nil {
		t.Fatal(err)
	}
	if out != "show me CPU usage" {
		t.Fatalf("chat messages must pass through verbatim, got: %s", out)
	}
}

func TestBuildUserPrompt_InvestigationWithoutPrefixUsesFullMessage(t *testing.T) {
	r, err := NewPromptRegistry(PluginSettings{})
	if err != nil {
		t.Fatal(err)
	}
	reg := newTestSkillRegistry(t)
	act, err := skills.Resolve(reg, "HighErrorRate is firing", nil, "investigation")
	if err != nil {
		t.Fatal(err)
	}
	ctx := BuildToolContext("Org1", "Admin")
	ctx.UserPromptSkill = act.UserPromptSkill

	// Historical contract: without an alertName: prefix the whole message
	// becomes the alert name; the error branch only fires on an empty name.
	out, err := r.BuildUserPrompt("investigation", "HighErrorRate is firing", ctx)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, `Investigate the alert "HighErrorRate is firing"`) {
		t.Fatalf("expected full message as alert name, got: %s", out)
	}

	_, err = r.BuildUserPrompt("investigation", "", ctx)
	if err == nil || !strings.Contains(err.Error(), "alertName") {
		t.Fatalf("expected alertName error for empty message, got: %v", err)
	}
}

func TestBuildUserPrompt_UnknownTypeErrors(t *testing.T) {
	r, err := NewPromptRegistry(PluginSettings{})
	if err != nil {
		t.Fatal(err)
	}
	_, err = r.BuildUserPrompt("discovery-ish", "hi", BuildToolContext("Org1", "Admin"))
	if err == nil {
		t.Fatal("expected unknown conversation type error")
	}
}

func TestHandlePromptDefaults_DisabledSkillStillReturnsStableKeys(t *testing.T) {
	// Regression: the investigation/performance keys must always be present —
	// a disabled skill falls back to the shipped bundled template instead of
	// dropping the key.
	disabled := false
	p := &Plugin{
		logger: log.DefaultLogger,
		skillRegistry: skills.NewRegistry(skills.Settings{Entries: map[string]skills.Entry{
			skills.TypeSkillNames["investigation"]: {Enabled: &disabled},
		}}, log.DefaultLogger),
	}

	req := httptest.NewRequest(http.MethodGet, "/api/prompt-defaults", nil)
	rec := httptest.NewRecorder()
	p.handlePromptDefaults(rec, req)

	var body map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	for _, key := range []string{"investigationPrompt", "performancePrompt"} {
		if value, ok := body[key]; !ok || value == "" {
			t.Errorf("key %q must always be present and non-empty, got %q", key, value)
		}
	}
	if !strings.Contains(body["investigationPrompt"], "{{.AlertName}}") {
		t.Errorf("disabled skill must fall back to the bundled default template, got: %.60s", body["investigationPrompt"])
	}
}

func TestHandleSkills_HiddenSkillsOnlyForAdminContentListing(t *testing.T) {
	// Regression: hidden skill metadata must not leak to non-admin callers.
	registry := skills.NewRegistry(skills.Settings{Entries: map[string]skills.Entry{
		"internal-hidden-skill": {Content: "---\nname: internal-hidden-skill\ndescription: internal pipeline skill\nmetadata:\n  visibility: hidden\n---\nbody"},
	}}, log.DefaultLogger)
	p := &Plugin{logger: log.DefaultLogger, skillRegistry: registry}

	decodeNames := func(rec *httptest.ResponseRecorder) map[string]bool {
		var body struct {
			Skills []skills.Info `json:"skills"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatalf("failed to decode response: %v", err)
		}
		names := map[string]bool{}
		for _, info := range body.Skills {
			names[info.Name] = true
		}
		return names
	}

	// Default (Viewer) listing excludes the hidden skill.
	req := httptest.NewRequest(http.MethodGet, "/api/skills", nil)
	rec := httptest.NewRecorder()
	p.handleSkills(rec, req)
	if names := decodeNames(rec); names["internal-hidden-skill"] {
		t.Fatal("hidden skill must not appear in the non-admin listing")
	}

	// Admin content listing includes it for management.
	req = httptest.NewRequest(http.MethodGet, "/api/skills?include=content", nil)
	req.Header.Set("X-Grafana-User-Role", "Admin")
	rec = httptest.NewRecorder()
	p.handleSkills(rec, req)
	if names := decodeNames(rec); !names["internal-hidden-skill"] {
		t.Fatal("Admin content listing must include hidden skills for management")
	}

	// Non-admin content request is rejected.
	req = httptest.NewRequest(http.MethodGet, "/api/skills?include=content", nil)
	req.Header.Set("X-Grafana-User-Role", "Viewer")
	rec = httptest.NewRecorder()
	p.handleSkills(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("non-admin include=content must be forbidden, got %d", rec.Code)
	}
}

func TestApplyLegacyPromptOverrides_SkillsTabEntryWins(t *testing.T) {
	// Regression: once a skill is managed through the Skills tab (any entry),
	// the legacy pre-skills prompt field must stop overriding it so admins
	// can change or clear the customization there.
	legacyPrompt := "Investigate {{.AlertName}} the legacy way."

	withEntry := skills.NewRegistry(skills.Settings{Entries: map[string]skills.Entry{
		skills.TypeSkillNames["investigation"]: {Content: "---\nname: investigating-alerts\ndescription: d\nmetadata:\n  user-prompt: |\n    Skills tab version {{.AlertName}}\n---\nbody"},
	}}, log.DefaultLogger)
	applyLegacyPromptOverrides(withEntry, PluginSettings{InvestigationPrompt: legacyPrompt}, log.DefaultLogger)
	s, ok := withEntry.Get(skills.TypeSkillNames["investigation"])
	if !ok {
		t.Fatal("skill must stay active")
	}
	if !strings.Contains(s.UserPrompt, "Skills tab version") {
		t.Fatalf("Skills-tab entry must win over the legacy field, got: %.60s", s.UserPrompt)
	}

	withoutEntry := skills.NewRegistry(skills.Settings{}, log.DefaultLogger)
	applyLegacyPromptOverrides(withoutEntry, PluginSettings{InvestigationPrompt: legacyPrompt}, log.DefaultLogger)
	s, ok = withoutEntry.Get(skills.TypeSkillNames["investigation"])
	if !ok || !strings.Contains(s.UserPrompt, "the legacy way") {
		t.Fatalf("legacy field must still apply when the skill is unmanaged, got: %.60s", s.UserPrompt)
	}
}
