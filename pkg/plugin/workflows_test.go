package plugin

import (
	"hash/fnv"
	"strconv"
	"strings"
	"testing"

	"consensys-asko11y-app/pkg/skills"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
)

// workflowTestRegistry builds a registry whose custom skills are valid for
// workflow entries.
func workflowTestRegistry(names ...string) *skills.Registry {
	entries := map[string]skills.Entry{}
	for _, name := range names {
		entries[name] = skills.Entry{
			Content: "---\nname: " + name + "\ndescription: Test skill for workflows.\n---\nBody for " + name,
		}
	}
	return skills.NewRegistry(skills.Settings{Entries: entries}, log.DefaultLogger)
}

func validWorkflowEntry() WorkflowEntry {
	return WorkflowEntry{
		Name:                  "noc-dispatch",
		Enabled:               true,
		Skill:                 "dispatch",
		IntervalSec:           120,
		SessionTimeoutSeconds: 120,
		ToolAllowlist:         []string{"mcp-grafana_list_alert_groups"},
		MaxConcurrentSessions: 3,
	}
}

func TestValidateWorkflowEntryAcceptsValidEntry(t *testing.T) {
	entry := validWorkflowEntry()
	registry := workflowTestRegistry("dispatch")
	tools := map[string]bool{"mcp-grafana_list_alert_groups": true}
	if err := validateWorkflowEntry(entry, registry, tools); err != nil {
		t.Fatalf("valid entry rejected: %v", err)
	}
}

func TestValidateWorkflowEntryDefersAllowlistCheckWithoutTools(t *testing.T) {
	entry := validWorkflowEntry()
	entry.ToolAllowlist = []string{"not_listed_anywhere"}
	registry := workflowTestRegistry("dispatch")
	// Empty tool listing (servers still connecting): the check is deferred,
	// not fatal, so startup with slow MCP servers does not disable entries.
	if err := validateWorkflowEntry(entry, registry, map[string]bool{}); err != nil {
		t.Fatalf("entry must pass with an empty tool listing: %v", err)
	}
}

func TestValidateWorkflowEntryRejectsDefects(t *testing.T) {
	registry := workflowTestRegistry("dispatch", "investigate", "escalate")
	tools := map[string]bool{"t_a": true, "mcp-grafana_list_alert_groups": true, "mcp-grafana_update_alert_group": true}

	cases := []struct {
		name   string
		mutate func(*WorkflowEntry)
		want   string
	}{
		{"no name", func(e *WorkflowEntry) { e.Name = "" }, "no name"},
		{"interval floor", func(e *WorkflowEntry) { e.IntervalSec = 30 }, "intervalSeconds"},
		{"timeout floor", func(e *WorkflowEntry) { e.SessionTimeoutSeconds = 10 }, "sessionTimeoutSeconds"},
		{"bad model", func(e *WorkflowEntry) { e.Model = "giant" }, "model"},
		{"missing skill", func(e *WorkflowEntry) { e.Skill = "" }, "skill is required"},
		{"unknown skill", func(e *WorkflowEntry) { e.Skill = "nope" }, "unknown skill"},
		{"empty allowlist", func(e *WorkflowEntry) { e.ToolAllowlist = nil }, "toolAllowlist"},
		{"unknown allowlist tool", func(e *WorkflowEntry) { e.ToolAllowlist = []string{"ghost_tool"} }, "unknown tool"},
		{"unknown spawnable skill", func(e *WorkflowEntry) { e.SpawnableSkills = []string{"nope"} }, "spawnable"},
		{"unknown fallback skill", func(e *WorkflowEntry) { e.FallbackSkill = "nope" }, "fallback"},
	}
	for _, tc := range cases {
		entry := validWorkflowEntry()
		entry.ToolAllowlist = []string{"t_a"}
		tc.mutate(&entry)
		err := validateWorkflowEntry(entry, registry, tools)
		if err == nil {
			t.Errorf("%s: defect accepted", tc.name)
			continue
		}
		// A nameless entry cannot name itself; every other error must.
		if tc.name != "no name" && !strings.Contains(err.Error(), "noc-dispatch") {
			t.Errorf("%s: error must name the workflow, got %q", tc.name, err.Error())
		}
		if !strings.Contains(err.Error(), tc.want) {
			t.Errorf("%s: error must mention %q, got %q", tc.name, tc.want, err.Error())
		}
	}
}

// The workflow name is a route segment, a Redis key fragment, and a metric
// label value, so its shape is validated: spaces inside stay legal, separators
// and control characters do not, and the byte cap matches the label cap.
func TestValidateWorkflowEntryNameShape(t *testing.T) {
	registry := workflowTestRegistry("dispatch")
	tools := map[string]bool{"mcp-grafana_list_alert_groups": true}

	cases := []struct {
		name    string
		wfName  string
		wantErr string
	}{
		{"plain with a space", "Nightly RCA", ""},
		{"punctuation", "a-b_c.d", ""},
		{"surrounding spaces trim", "  Nightly RCA  ", ""},
		{"unicode", "nächtliche-rca", ""},
		{"exactly 64 bytes", strings.Repeat("a", 64), ""},
		{"empty", "", "no name"},
		{"spaces only", "   ", "no name"},
		{"route separator", "x/runs/y", "/"},
		{"single slash", "a/b", "/"},
		{"nul byte", "a\x00b", "control"},
		{"newline", "a\nb", "control"},
		{"65 bytes", strings.Repeat("a", 65), "at most"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			entry := validWorkflowEntry()
			entry.Name = tc.wfName
			entry.ToolAllowlist = []string{"mcp-grafana_list_alert_groups"}
			err := validateWorkflowEntry(entry, registry, tools)
			if tc.wantErr == "" {
				if err != nil {
					t.Fatalf("%q must pass, got %v", tc.wfName, err)
				}
				return
			}
			if err == nil {
				t.Fatalf("%q must be rejected", tc.wfName)
			}
			if !strings.Contains(err.Error(), tc.wantErr) {
				t.Fatalf("%q: error must mention %q, got %q", tc.wfName, tc.wantErr, err.Error())
			}
		})
	}
}

func TestPrepareWorkflowsDisablesOnlyInvalidEntries(t *testing.T) {
	registry := workflowTestRegistry("dispatch", "collect")
	tools := map[string]bool{"t_a": true, "t_b": true}

	valid := validWorkflowEntry()
	valid.Name = "keep-me"
	valid.ToolAllowlist = []string{"t_a"}
	invalid := validWorkflowEntry()
	invalid.Name = "drop-me"
	invalid.Skill = "missing-skill"
	disabled := validWorkflowEntry()
	disabled.Name = "off-me"
	disabled.Enabled = false
	duplicate := validWorkflowEntry()
	duplicate.Name = "keep-me"

	got := prepareWorkflows([]WorkflowEntry{valid, invalid, disabled, duplicate}, 7, registry, tools, log.DefaultLogger)
	if len(got) != 1 {
		t.Fatalf("expected exactly the one valid enabled entry, got %d", len(got))
	}
	if got[0].Name != "keep-me" {
		t.Fatalf("wrong entry survived: %q", got[0].Name)
	}
	if got[0].OrgID != 7 {
		t.Fatalf("the server must stamp the entry's org, got %d", got[0].OrgID)
	}
	if got[0].IntervalSec != 120 {
		t.Fatalf("defaults must not overwrite explicit values: %d", got[0].IntervalSec)
	}
}

func TestPrepareWorkflowsAppliesDefaults(t *testing.T) {
	registry := workflowTestRegistry("dispatch")
	entry := validWorkflowEntry()
	entry.IntervalSec = 0
	entry.SessionTimeoutSeconds = 0
	entry.MaxConcurrentSessions = 0

	got := prepareWorkflows([]WorkflowEntry{entry}, 0, registry, nil, log.DefaultLogger)
	if len(got) != 1 {
		t.Fatalf("entry must survive: %d", len(got))
	}
	if got[0].IntervalSec != workflowDefaultIntervalSeconds {
		t.Fatalf("interval default not applied: %d", got[0].IntervalSec)
	}
	if got[0].SessionTimeoutSeconds != workflowDefaultTimeoutSeconds {
		t.Fatalf("timeout default not applied: %d", got[0].SessionTimeoutSeconds)
	}
	if got[0].MaxConcurrentSessions != workflowDefaultMaxConcurrent {
		t.Fatalf("concurrency default not applied: %d", got[0].MaxConcurrentSessions)
	}
}

func TestWorkflowMessageDefaultAndOverride(t *testing.T) {
	entry := validWorkflowEntry()
	if got := workflowMessage(entry); !strings.Contains(got, "dispatch") {
		t.Fatalf("default message must name the skill: %q", got)
	}
	entry.Message = "Sweep the queue."
	if got := workflowMessage(entry); got != "Sweep the queue." {
		t.Fatalf("explicit message must win: %q", got)
	}
}

func TestSyntheticWorkflowUserIDStableAndDistinct(t *testing.T) {
	a := syntheticWorkflowUserID("alpha", 1)
	b := syntheticWorkflowUserID("alpha", 1)
	c := syntheticWorkflowUserID("beta", 1)
	if a != b {
		t.Fatal("same workflow must map to the same synthetic user")
	}
	if a == c {
		t.Fatal("different workflows must map to different synthetic users")
	}
	if a <= 0 {
		t.Fatal("synthetic user ID must be positive")
	}
	// The same name in two orgs is two owners, never one.
	if other := syntheticWorkflowUserID("alpha", 2); other == a {
		t.Fatalf("the same workflow name in two orgs must not share an owner: %d", other)
	}
}

// realLoginUserID replicates getUserID's scheme for a plain Grafana login
// string, so tests can show the two input domains stay disjoint.
func realLoginUserID(login string) int64 {
	h := fnv.New64a()
	h.Write([]byte(login))
	return int64(h.Sum64() & 0x7FFFFFFFFFFFFFFF)
}

func TestSyntheticUserIDHelpersAgree(t *testing.T) {
	for _, name := range []string{"alpha", "beta", "nightly-sweep", "with space", "ünïcode"} {
		for _, orgID := range []int64{0, 1, 2, 99} {
			if got, want := fnvSyntheticUserID(name, orgID), syntheticWorkflowUserID(name, orgID); got != want {
				t.Fatalf("helpers disagree for %q org %d: fnv=%d synthetic=%d", name, orgID, got, want)
			}
		}
	}
}

func TestSyntheticWorkflowUserIDCannotCollideWithRealLogin(t *testing.T) {
	for _, name := range []string{"alpha", "beta", "nightly-sweep", "wf"} {
		for _, orgID := range []int64{1, 2} {
			synthetic := syntheticWorkflowUserID(name, orgID)
			// A real Grafana login naming the workflow, with or without the
			// org, is the attack: the NUL-prefixed domain keeps them apart.
			for _, forgedLogin := range []string{
				"workflow:" + name,
				"workflow:" + strconv.FormatInt(orgID, 10) + ":" + name,
			} {
				if forged := realLoginUserID(forgedLogin); synthetic == forged {
					t.Fatalf("synthetic user ID for %q org %d collides with real login %q: %d",
						name, orgID, forgedLogin, synthetic)
				}
			}
		}
	}
}
