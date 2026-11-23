package plugin

import (
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
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
	Name string `json:"name"`
	// OrgID is the org that owns this entry. The server stamps it; a value
	// from client settings is never trusted. It scopes the entry's Redis
	// keys, synthetic owner, applied-set membership, and metrics.
	OrgID       int64  `json:"orgId"`
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

// workflowEntryProblem names one stored entry that prepareWorkflowEntries
// refused, and why. Reconcile keeps the last problem per entry so a 30 second
// loop logs a defect once, not on every pass.
type workflowEntryProblem struct {
	Name  string
	Error string
}

// prepareWorkflowEntries validates every stored entry and returns the valid,
// default-filled, enabled ones plus one problem per refused entry. Valid
// entries are unaffected by a refused one (fail fast per entry, never for the
// whole plugin).
//
// A disabled entry is not a problem: the admin switched it off on purpose, so
// it is simply left out of the returned entries. Its absence from the applied
// set stops any scheduler that was running for it.
//
// Every returned entry is stamped with defaultOrgID, regardless of what its
// stored payload held: the org is server-owned and comes from the store key.
func prepareWorkflowEntries(entries []WorkflowEntry, defaultOrgID int64, registry *skills.Registry, allowlistTools map[string]bool) ([]WorkflowEntry, []workflowEntryProblem) {
	seen := map[string]bool{}
	valid := make([]WorkflowEntry, 0, len(entries))
	problems := make([]workflowEntryProblem, 0)
	for _, raw := range entries {
		entry := raw
		entry.OrgID = defaultOrgID
		entry.Name = strings.TrimSpace(entry.Name)
		if seen[entry.Name] {
			problems = append(problems, workflowEntryProblem{Name: entry.Name, Error: "duplicate name"})
			continue
		}
		seen[entry.Name] = true
		// Defaults first, then validation: an unset interval is "use the
		// default", not "below the floor"; only an explicit 1..59 value is
		// a floor violation.
		entry.applyDefaults()
		if err := validateWorkflowEntry(entry, registry, allowlistTools); err != nil {
			problems = append(problems, workflowEntryProblem{Name: entry.Name, Error: err.Error()})
			continue
		}
		// The off switch is deliberate: exclude the entry without reporting
		// it as a defect. Problems are reserved for real validation errors.
		if !entry.Enabled {
			continue
		}
		valid = append(valid, entry)
	}
	return valid, problems
}

// prepareWorkflows logs every refused entry once and returns the valid ones.
// It is the startup-shaped wrapper over prepareWorkflowEntries. A disabled
// entry is not refused and produces no log line: the off switch is deliberate.
func prepareWorkflows(entries []WorkflowEntry, defaultOrgID int64, registry *skills.Registry, allowlistTools map[string]bool, logger log.Logger) []WorkflowEntry {
	valid, problems := prepareWorkflowEntries(entries, defaultOrgID, registry, allowlistTools)
	for _, problem := range problems {
		if problem.Error == "duplicate name" {
			logger.Error("Workflow entry disabled: duplicate name", "workflow", problem.Name)
			continue
		}
		logger.Error("Workflow entry disabled: invalid configuration", "workflow", problem.Name, "error", problem.Error)
	}
	return valid
}

// legacyWorkflowEntryCount reports the entry count of a legacy
// jsonData.workflows setting and whether the key is present at all. Entries
// live in the per-org Redis store now; the settings key is read only to warn
// once per instance load, never to start a scheduler.
func legacyWorkflowEntryCount(jsonData []byte) (int, bool) {
	var envelope struct {
		Workflows json.RawMessage `json:"workflows"`
	}
	if err := json.Unmarshal(jsonData, &envelope); err != nil {
		return 0, false
	}
	if len(envelope.Workflows) == 0 || string(envelope.Workflows) == "null" {
		return 0, false
	}
	var entries []WorkflowEntry
	if err := json.Unmarshal(envelope.Workflows, &entries); err != nil {
		// A malformed value still proves the setting exists; report zero.
		return 0, true
	}
	return len(entries), true
}

// workflowMessage returns the first user message for a tick of this entry.
func workflowMessage(entry WorkflowEntry) string {
	if msg := strings.TrimSpace(entry.Message); msg != "" {
		return msg
	}
	return fmt.Sprintf("Run the %s workflow now.", entry.Skill)
}

// syntheticWorkflowUserID derives the stable synthetic user ID for a workflow
// in one org, using the same FNV-of-login scheme as interactive user IDs but
// over the NUL-prefixed synthetic domain. The ID owns the workflow's sessions;
// it never maps to a real Grafana user, and the same name in two orgs gets two
// different IDs, so neither org's shares or runs reach the other.
func syntheticWorkflowUserID(workflow string, orgID int64) int64 {
	return fnvSyntheticUserID(workflow, orgID)
}

// appliedWorkflowNamesKeyPrefix scopes the applied-set of each org: the set
// records the workflow names of the last settings load for that org only.
const appliedWorkflowNamesKeyPrefix = "workflows:applied:"

// appliedWorkflowNamesKey is the Redis set of workflow names recorded by the
// last settings load of one org. Settings changes take effect by restarting
// the plugin process, so the previous set must outlive the process for a
// removed entry to be detected.
func appliedWorkflowNamesKey(orgID int64) string {
	return appliedWorkflowNamesKeyPrefix + strconv.FormatInt(orgID, 10)
}

// revokeRemovedWorkflowShares deletes the shares of every workflow whose entry
// the applied settings no longer list, so no unauthenticated share URL for a
// removed workflow keeps working. It is called at the settings-apply seam
// (NewPlugin, before startWorkflows) and records the current entry names.
//
// The diff is per org: entries are grouped by their owning org, and each org's
// applied set and synthetic owners are read and deleted separately, so a
// removal in one org never touches another org's shares.
//
// An org in unreadable had no entry list to diff: its stored record failed to
// read, so it is skipped entirely. Treating a failed read as an empty list
// would delete that org's shares and persist an empty applied set.
func (p *Plugin) revokeRemovedWorkflowShares(entries []WorkflowEntry, unreadable map[int64]bool) {
	current := make(map[int64]map[string]bool)
	for _, entry := range entries {
		name := strings.TrimSpace(entry.Name)
		if name == "" {
			continue
		}
		if current[entry.OrgID] == nil {
			current[entry.OrgID] = map[string]bool{}
		}
		current[entry.OrgID][name] = true
	}

	orgs := make(map[int64]bool, len(current))
	for orgID := range current {
		orgs[orgID] = true
	}
	// Orgs whose last entry disappeared have no current group; their persisted
	// applied sets still name the removed entries.
	for orgID := range p.appliedWorkflowOrgs() {
		orgs[orgID] = true
	}
	for orgID := range orgs {
		if unreadable[orgID] {
			continue
		}
		p.revokeRemovedWorkflowSharesForOrg(orgID, current[orgID])
	}
}

// revokeRemovedWorkflowSharesForOrg revokes one org's removed entries.
func (p *Plugin) revokeRemovedWorkflowSharesForOrg(orgID int64, current map[string]bool) {
	previous := p.recordAppliedWorkflowNames(orgID, current)
	for name := range previous {
		if current[name] {
			continue
		}
		removed, err := p.shareStore.DeleteSharesByUser(syntheticWorkflowUserID(name, orgID))
		if err != nil {
			p.logger.Warn("Failed to revoke shares for removed workflow",
				"workflow", name, "orgId", orgID, "error", err)
			continue
		}
		if removed > 0 {
			p.logger.Info("Revoked shares for removed workflow",
				"workflow", name, "orgId", orgID, "shareCount", removed)
		}
	}
}

// appliedWorkflowOrgs lists the orgs with an applied set, in memory or Redis,
// so an org that lost its last workflow entry is still diffed.
func (p *Plugin) appliedWorkflowOrgs() map[int64]bool {
	orgs := map[int64]bool{}
	p.settingsMu.RLock()
	for orgID := range p.appliedWorkflows {
		orgs[orgID] = true
	}
	p.settingsMu.RUnlock()

	if !p.usingRedis || p.redisClient == nil {
		return orgs
	}
	ctx, cancel := redisContext(p.ctx, RedisBulkOpTimeout)
	defer cancel()
	iter := p.redisClient.Scan(ctx, 0, appliedWorkflowNamesKeyPrefix+"*", 100).Iterator()
	for iter.Next(ctx) {
		suffix, ok := strings.CutPrefix(iter.Val(), appliedWorkflowNamesKeyPrefix)
		if !ok {
			continue
		}
		if orgID, err := strconv.ParseInt(suffix, 10, 64); err == nil {
			orgs[orgID] = true
		}
	}
	if err := iter.Err(); err != nil {
		p.logger.Warn("Failed to list applied workflow orgs", "error", err)
	}
	return orgs
}

// recordAppliedWorkflowNames returns the workflow names applied by the
// previous settings load of one org and records current as the new set. Redis
// holds the set across restarts; the in-memory copy covers a reapply inside
// one process and the configuration where no workflow ever ran because Redis
// is absent.
func (p *Plugin) recordAppliedWorkflowNames(orgID int64, current map[string]bool) map[string]bool {
	p.settingsMu.Lock()
	if p.appliedWorkflows == nil {
		p.appliedWorkflows = make(map[int64]map[string]bool)
	}
	previous := p.appliedWorkflows[orgID]
	p.appliedWorkflows[orgID] = current
	p.settingsMu.Unlock()

	if !p.usingRedis || p.redisClient == nil {
		return previous
	}
	for name := range p.readAppliedWorkflowNames(orgID) {
		if previous == nil {
			previous = map[string]bool{}
		}
		previous[name] = true
	}
	p.writeAppliedWorkflowNames(orgID, current)
	return previous
}

// readAppliedWorkflowNames returns one org's persisted name set, or nil when
// Redis cannot answer.
func (p *Plugin) readAppliedWorkflowNames(orgID int64) map[string]bool {
	ctx, cancel := redisContext(p.ctx, RedisBulkOpTimeout)
	defer cancel()
	names, err := p.redisClient.SMembers(ctx, appliedWorkflowNamesKey(orgID)).Result()
	if err != nil {
		p.logger.Warn("Failed to read applied workflow names", "orgId", orgID, "error", err)
		return nil
	}
	set := make(map[string]bool, len(names))
	for _, name := range names {
		set[name] = true
	}
	return set
}

// writeAppliedWorkflowNames replaces one org's persisted name set.
func (p *Plugin) writeAppliedWorkflowNames(orgID int64, names map[string]bool) {
	ctx, cancel := redisContext(p.ctx, RedisOpTimeout)
	defer cancel()
	key := appliedWorkflowNamesKey(orgID)
	pipe := p.redisClient.TxPipeline()
	pipe.Del(ctx, key)
	for name := range names {
		pipe.SAdd(ctx, key, name)
	}
	if _, err := pipe.Exec(ctx); err != nil {
		p.logger.Warn("Failed to persist applied workflow names", "orgId", orgID, "error", err)
	}
}
