package plugin

import (
	"fmt"
	"strings"

	"consensys-asko11y-app/pkg/skills"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
)

// Workflow defaults. The interval floor protects LLM spend; the timeout floor
// keeps the watchdog from racing a normal first tool call.
const (
	workflowDefaultIntervalSeconds = 300
	workflowMinIntervalSeconds     = 60
	workflowDefaultTimeoutSeconds  = 300
	workflowMinTimeoutSeconds      = 60
	workflowDefaultMaxConcurrent   = 5
)

// workflowConversationType marks sessions created by the workflow runner.
const workflowConversationType = "workflow"

// WorkflowEntry is one provisioned autonomous workflow. Entries arrive from
// app instance settings jsonData.workflows (or the equivalent provisioning
// file) and are pure configuration: the plugin ships no entries and no
// workflow behaviour of its own.
type WorkflowEntry struct {
	Name        string `json:"name"`
	Enabled     bool   `json:"enabled"`
	OrgID       int64  `json:"orgId"`
	Skill       string `json:"skill"`
	Message     string `json:"message,omitempty"`
	Model       string `json:"model,omitempty"`
	IntervalSec int    `json:"intervalSeconds,omitempty"`
	// MaxIterations overrides the skill's iteration budget when set.
	MaxIterations int `json:"maxIterations,omitempty"`
	// ToolAllowlist names the exact MCP tools the workflow's sessions may
	// list and call. Empty is invalid: an unattended run must be scoped.
	ToolAllowlist []string `json:"toolAllowlist"`
	// SpawnableSkills names the skills a dispatcher session may start with
	// spawn_session. Empty disables the spawn tool for this workflow.
	SpawnableSkills []string `json:"spawnableSkills,omitempty"`
	// MaxConcurrentSessions bounds active spawned sessions across replicas,
	// counted through the Redis active set.
	MaxConcurrentSessions int `json:"maxConcurrentSessions,omitempty"`
	// SessionTimeoutSeconds is the watchdog budget for every session of this
	// workflow, top-level and spawned alike.
	SessionTimeoutSeconds int    `json:"sessionTimeoutSeconds,omitempty"`
	FallbackSkill         string `json:"fallbackSkill,omitempty"`
}

// applyWorkflowDefaults fills unset numeric fields with their defaults.
func (e *WorkflowEntry) applyDefaults() {
	if e.IntervalSec <= 0 {
		e.IntervalSec = workflowDefaultIntervalSeconds
	}
	if e.SessionTimeoutSeconds <= 0 {
		e.SessionTimeoutSeconds = workflowDefaultTimeoutSeconds
	}
	if e.MaxConcurrentSessions <= 0 {
		e.MaxConcurrentSessions = workflowDefaultMaxConcurrent
	}
}

// validateWorkflowEntry checks one entry against the registry and returns a
// named error for every defect. allowlistTools is the set of currently known
// MCP tool names; when it is empty the allowlist check is deferred to the
// first tick (MCP servers may still be connecting at startup).
func validateWorkflowEntry(entry WorkflowEntry, registry *skills.Registry, allowlistTools map[string]bool) error {
	name := strings.TrimSpace(entry.Name)
	if name == "" {
		return fmt.Errorf("workflow entry has no name")
	}
	if entry.OrgID <= 0 {
		return fmt.Errorf("workflow %s: orgId must be a positive org number", name)
	}
	if entry.IntervalSec < workflowMinIntervalSeconds {
		return fmt.Errorf("workflow %s: intervalSeconds must be at least %d", name, workflowMinIntervalSeconds)
	}
	if entry.SessionTimeoutSeconds < workflowMinTimeoutSeconds {
		return fmt.Errorf("workflow %s: sessionTimeoutSeconds must be at least %d", name, workflowMinTimeoutSeconds)
	}
	if entry.Model != "" && entry.Model != agentModelBase && entry.Model != agentModelLarge {
		return fmt.Errorf("workflow %s: model must be empty, base, or large", name)
	}
	if entry.Skill == "" {
		return fmt.Errorf("workflow %s: skill is required", name)
	}
	if s, ok := registry.Get(entry.Skill); !ok || s.Visibility != skills.VisibilityPublic {
		return fmt.Errorf("workflow %s: unknown skill %s", name, entry.Skill)
	}
	if len(entry.ToolAllowlist) == 0 {
		return fmt.Errorf("workflow %s: toolAllowlist must name at least one tool", name)
	}
	if len(allowlistTools) > 0 {
		for _, tool := range entry.ToolAllowlist {
			if !allowlistTools[tool] {
				return fmt.Errorf("workflow %s: allowlist names unknown tool %s", name, tool)
			}
		}
	}
	for _, skill := range entry.SpawnableSkills {
		if s, ok := registry.Get(skill); !ok || s.Visibility != skills.VisibilityPublic {
			return fmt.Errorf("workflow %s: spawnable skill %s is unknown", name, skill)
		}
	}
	if entry.FallbackSkill != "" {
		if s, ok := registry.Get(entry.FallbackSkill); !ok || s.Visibility != skills.VisibilityPublic {
			return fmt.Errorf("workflow %s: fallback skill %s is unknown", name, entry.FallbackSkill)
		}
	}
	return nil
}

// prepareWorkflows validates every configured entry and returns the valid,
// default-filled, enabled ones. An invalid entry is dropped with one error
// log naming it; valid entries are unaffected (fail fast per entry, never
// for the whole plugin).
func prepareWorkflows(entries []WorkflowEntry, registry *skills.Registry, allowlistTools map[string]bool, logger log.Logger) []WorkflowEntry {
	seen := map[string]bool{}
	valid := make([]WorkflowEntry, 0, len(entries))
	for _, raw := range entries {
		entry := raw
		entry.Name = strings.TrimSpace(entry.Name)
		if seen[entry.Name] {
			logger.Error("Workflow entry disabled: duplicate name", "workflow", entry.Name)
			continue
		}
		seen[entry.Name] = true
		// Defaults first, then validation: an unset interval is "use the
		// default", not "below the floor"; only an explicit 1..59 value is
		// a floor violation.
		entry.applyDefaults()
		if err := validateWorkflowEntry(entry, registry, allowlistTools); err != nil {
			logger.Error("Workflow entry disabled: invalid configuration", "error", err.Error())
			continue
		}
		if !entry.Enabled {
			logger.Info("Workflow entry present but disabled", "workflow", entry.Name)
			continue
		}
		valid = append(valid, entry)
	}
	return valid
}

// workflowMessage returns the first user message for a tick of this entry.
func workflowMessage(entry WorkflowEntry) string {
	if msg := strings.TrimSpace(entry.Message); msg != "" {
		return msg
	}
	return fmt.Sprintf("Run the %s workflow now.", entry.Skill)
}

// syntheticWorkflowUserID derives the stable synthetic user ID for a
// workflow, using the same FNV-of-login scheme as interactive user IDs. The
// ID owns the workflow's sessions; it never maps to a real Grafana user.
func syntheticWorkflowUserID(workflow string) int64 {
	return fnvSyntheticUserID("workflow:" + workflow)
}
