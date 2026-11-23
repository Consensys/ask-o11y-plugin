package plugin

import (
	"errors"
	"fmt"
	"strings"
	"unicode"

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

// workflowMaxNameLength bounds a workflow name in bytes, matching the
// maxWorkflowLabelLength truncation the metrics apply: a longer name would
// make two entries share one metric label while staying distinct schedulers.
const workflowMaxNameLength = 64

// workflowConversationType marks sessions created by the workflow runner.
const workflowConversationType = "workflow"

// errWorkflowUnknownTool marks an allowlist entry naming a tool no configured
// MCP server provides. It is a sentinel because its handling differs from
// other defects: while the MCP catalog is not yet stable, the tool may simply
// not be listed yet, so the caller can defer instead of disabling the entry.
var errWorkflowUnknownTool = errors.New("allowlist names unknown tool")

// WorkflowEntry is one provisioned autonomous workflow. Entries arrive from
// app instance settings jsonData.workflows (or the equivalent provisioning
// file) and are pure configuration: the plugin ships no entries and no
// workflow behaviour of its own.
type WorkflowEntry struct {
	Name        string `json:"name"`
	Enabled     bool   `json:"enabled"`
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
	// The name is a route segment, a Redis key fragment, and a metric label
	// value. A "/" makes the runs GET and the share POST cut the path at
	// different places, so the runs list succeeds while Open 404s; control
	// characters corrupt logs and key shapes; more than workflowMaxNameLength
	// bytes collides two entries on one truncated metric label. Spaces inside
	// the name stay legal ("Nightly RCA"). %q escapes hostile characters in
	// the log line.
	if strings.ContainsRune(name, '/') {
		return fmt.Errorf("workflow %q: name must not contain \"/\"", name)
	}
	for _, r := range name {
		if unicode.IsControl(r) {
			return fmt.Errorf("workflow %q: name must not contain control characters", name)
		}
	}
	if len(name) > workflowMaxNameLength {
		return fmt.Errorf("workflow %q: name must be at most %d bytes", name, workflowMaxNameLength)
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
				return fmt.Errorf("workflow %s: %w %s", name, errWorkflowUnknownTool, tool)
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
// workflow, using the same FNV-of-login scheme as interactive user IDs but
// over the NUL-prefixed synthetic domain. The ID owns the workflow's sessions;
// it never maps to a real Grafana user.
func syntheticWorkflowUserID(workflow string) int64 {
	return fnvSyntheticUserID(workflow)
}

// appliedWorkflowNamesKey is the Redis set of workflow names recorded by the
// last settings load. Settings changes take effect by restarting the plugin
// process, so the previous set must outlive the process for a removed entry
// to be detected.
const appliedWorkflowNamesKey = "workflows:applied"

// revokeRemovedWorkflowShares deletes the shares of every workflow whose entry
// the applied settings no longer list, so no unauthenticated share URL for a
// removed workflow keeps working. It is called at the settings-apply seam
// (NewPlugin, before startWorkflows) and records the current entry names.
func (p *Plugin) revokeRemovedWorkflowShares(entries []WorkflowEntry) {
	current := make(map[string]bool, len(entries))
	for _, entry := range entries {
		if name := strings.TrimSpace(entry.Name); name != "" {
			current[name] = true
		}
	}

	previous := p.recordAppliedWorkflowNames(current)
	for name := range previous {
		if current[name] {
			continue
		}
		removed, err := p.shareStore.DeleteSharesByUser(syntheticWorkflowUserID(name))
		if err != nil {
			p.logger.Warn("Failed to revoke shares for removed workflow", "workflow", name, "error", err)
			continue
		}
		if removed > 0 {
			p.logger.Info("Revoked shares for removed workflow", "workflow", name, "shareCount", removed)
		}
	}
}

// recordAppliedWorkflowNames returns the workflow names applied by the previous
// settings load and records current as the new set. Redis holds the set across
// restarts; the in-memory copy covers a reapply inside one process and the
// configuration where no workflow ever ran because Redis is absent.
func (p *Plugin) recordAppliedWorkflowNames(current map[string]bool) map[string]bool {
	p.settingsMu.Lock()
	previous := p.appliedWorkflows
	p.appliedWorkflows = current
	p.settingsMu.Unlock()

	if !p.usingRedis || p.redisClient == nil {
		return previous
	}
	for name := range p.readAppliedWorkflowNames() {
		if previous == nil {
			previous = map[string]bool{}
		}
		previous[name] = true
	}
	p.writeAppliedWorkflowNames(current)
	return previous
}

// readAppliedWorkflowNames returns the persisted name set, or nil when Redis
// cannot answer.
func (p *Plugin) readAppliedWorkflowNames() map[string]bool {
	ctx, cancel := redisContext(p.ctx, RedisBulkOpTimeout)
	defer cancel()
	names, err := p.redisClient.SMembers(ctx, appliedWorkflowNamesKey).Result()
	if err != nil {
		p.logger.Warn("Failed to read applied workflow names", "error", err)
		return nil
	}
	set := make(map[string]bool, len(names))
	for _, name := range names {
		set[name] = true
	}
	return set
}

// writeAppliedWorkflowNames replaces the persisted name set.
func (p *Plugin) writeAppliedWorkflowNames(names map[string]bool) {
	ctx, cancel := redisContext(p.ctx, RedisOpTimeout)
	defer cancel()
	pipe := p.redisClient.TxPipeline()
	pipe.Del(ctx, appliedWorkflowNamesKey)
	for name := range names {
		pipe.SAdd(ctx, appliedWorkflowNamesKey, name)
	}
	if _, err := pipe.Exec(ctx); err != nil {
		p.logger.Warn("Failed to persist applied workflow names", "error", err)
	}
}
