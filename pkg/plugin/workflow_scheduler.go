package plugin

import (
	"context"
	"errors"
	"fmt"
	"hash/fnv"
	"reflect"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"consensys-asko11y-app/pkg/mcp"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	"github.com/redis/go-redis/v9"
)

// syntheticUserIDDomain prefixes every hashed synthetic (non-Grafana) user
// ID. The leading NUL byte cannot appear in a Grafana login, so a real login
// can never hash into the synthetic namespace, even a login literally named
// "workflow:<org>:<name>".
const syntheticUserIDDomain = "\x00workflow:"

// fnvSyntheticUserID derives the stable synthetic user ID for a workflow name
// in one org. It uses the same FNV64a scheme as getUserID, over an input
// domain that no real Grafana login can occupy, and includes the org so the
// same workflow name in two orgs owns two different sets of sessions.
func fnvSyntheticUserID(workflow string, orgID int64) int64 {
	h := fnv.New64a()
	h.Write([]byte(syntheticUserIDDomain + strconv.FormatInt(orgID, 10) + ":" + workflow))
	return int64(h.Sum64() & 0x7FFFFFFFFFFFFFFF)
}

// workflowTickLockKey is the Redis key electing one replica per tick of one
// org's workflow.
func workflowTickLockKey(orgID int64, name string) string {
	return "workflow:" + strconv.FormatInt(orgID, 10) + ":" + name + ":tick"
}

// workflowActiveSpawnKey is the Redis ZSET counting active spawned sessions
// across replicas. Members are run IDs; scores are watchdog deadlines, so a
// member whose deadline passed is pruned on read and never blocks a spawn.
func workflowActiveSpawnKey(orgID int64, name string) string {
	return "workflow:" + strconv.FormatInt(orgID, 10) + ":" + name + ":active"
}

// workflowTopLevelActiveKey is the Redis key electing one in-flight top-level
// run per workflow. The value is the owning run ID. It is separate from the
// tick lock (:tick) and the spawned-session set (:active): ticks may fire
// while a top-level run from an earlier tick is still working, and only this
// key bounds those runs.
func workflowTopLevelActiveKey(orgID int64, name string) string {
	return "workflow:" + strconv.FormatInt(orgID, 10) + ":" + name + ":toplevel"
}

// workflowTopLevelActiveMargin extends the top-level key TTL past the run's
// own deadline, so a process that dies mid-run cannot deadlock the workflow:
// the key expires and the next tick proceeds.
const workflowTopLevelActiveMargin = 60 * time.Second

// acquireWorkflowTopLevelRun claims the one top-level slot of a workflow for
// runID. A held key means another top-level run is still in flight; the caller
// skips the tick instead of piling up a concurrent run.
func (p *Plugin) acquireWorkflowTopLevelRun(orgID int64, name, runID string, timeoutSeconds int) (bool, error) {
	if p.redisClient == nil {
		// No Redis: workflows only run single-instance, and the in-process
		// tracker already bounds this instance's runs. Nothing to gate.
		return true, nil
	}
	ttl := time.Duration(timeoutSeconds)*time.Second + workflowTopLevelActiveMargin
	ctx, cancel := redisContext(p.ctx, RedisOpTimeout)
	defer cancel()
	return p.redisClient.SetNX(ctx, workflowTopLevelActiveKey(orgID, name), runID, ttl).Result()
}

// workflowTopLevelReleaseScript deletes the key only when this run still owns
// it, so a run whose TTL already expired cannot free a successor's slot.
var workflowTopLevelReleaseScript = redis.NewScript(`
if redis.call("GET", KEYS[1]) == ARGV[1] then
	return redis.call("DEL", KEYS[1])
end
return 0
`)

// releaseWorkflowTopLevelRun frees the top-level slot and drops the run from
// the active-sessions gauge. The TTL is the safety net, not the normal path.
func (p *Plugin) releaseWorkflowTopLevelRun(orgID int64, name, runID string) {
	if p.redisClient != nil {
		ctx, cancel := redisContext(p.ctx, RedisOpTimeout)
		if err := workflowTopLevelReleaseScript.Run(ctx, p.redisClient,
			[]string{workflowTopLevelActiveKey(orgID, name)}, runID).Err(); err != nil {
			p.logger.Warn("Workflow top-level key release failed", "workflow", name, "orgId", orgID, "error", err)
		}
		cancel()
	}
	p.workflowTopLevelAdd(orgID, name, -1)
}

// acquireWorkflowTickLock elects this instance for one tick. The TTL is half
// the interval at most, so a crashed holder cannot starve the survivors.
func acquireWorkflowTickLock(ctx context.Context, client *redis.Client, orgID int64, name string, ttl time.Duration) (bool, error) {
	lockCtx, cancel := redisContext(ctx, RedisOpTimeout)
	defer cancel()
	return client.SetNX(lockCtx, workflowTickLockKey(orgID, name), "1", ttl).Result()
}

// workflowActiveSpawnAdd records a spawned session in the active set with its
// watchdog deadline as the score.
func (p *Plugin) workflowActiveSpawnAdd(orgID int64, name, runID string, deadline time.Time) error {
	if p.redisClient == nil {
		return fmt.Errorf("redis is not configured")
	}
	ctx, cancel := redisContext(p.ctx, RedisOpTimeout)
	defer cancel()
	return p.redisClient.ZAdd(ctx, workflowActiveSpawnKey(orgID, name), redis.Z{
		Score:  float64(deadline.Unix()),
		Member: runID,
	}).Err()
}

// workflowActiveSpawnRemove drops a finished spawned session from the active
// set. The gauge follows the surviving count so operators see the true
// in-flight number even after a prune.
func (p *Plugin) workflowActiveSpawnRemove(orgID int64, name, runID string) {
	if p.redisClient == nil {
		return
	}
	ctx, cancel := redisContext(p.ctx, RedisOpTimeout)
	defer cancel()
	if err := p.redisClient.ZRem(ctx, workflowActiveSpawnKey(orgID, name), runID).Err(); err != nil {
		p.logger.Warn("Workflow active-set remove failed", "workflow", name, "orgId", orgID, "error", err)
	}
	p.workflowActiveSpawnRefreshGauge(orgID, name)
}

// workflowSpawnTryAddScript admits one spawned session atomically: prune
// expired members, count, and only add when below the cap. The check and the
// add are one round trip so concurrent dispatchers (overlapping ticks,
// parallel tool calls) cannot both pass the count before either adds.
var workflowSpawnTryAddScript = redis.NewScript(`
redis.call("ZREMRANGEBYSCORE", KEYS[1], "-inf", ARGV[1])
local count = redis.call("ZCARD", KEYS[1])
if count >= tonumber(ARGV[4]) then
	return 0
end
redis.call("ZADD", KEYS[1], ARGV[2], ARGV[3])
return 1
`)

// workflowActiveSpawnTryAdd admits a spawned session under the workflow's
// cap in one atomic step. Returns false when the cap is reached.
func (p *Plugin) workflowActiveSpawnTryAdd(orgID int64, name, runID string, deadline time.Time, cap int) (bool, error) {
	if p.redisClient == nil {
		return false, fmt.Errorf("redis is not configured")
	}
	ctx, cancel := redisContext(p.ctx, RedisOpTimeout)
	defer cancel()
	res, err := workflowSpawnTryAddScript.Run(ctx, p.redisClient,
		[]string{workflowActiveSpawnKey(orgID, name)},
		fmt.Sprintf("%d", time.Now().Unix()),
		fmt.Sprintf("%d", deadline.Unix()),
		runID,
		cap,
	).Int()
	if err != nil {
		return false, err
	}
	return res == 1, nil
}

// workflowActiveSpawnCount prunes expired members and returns the number of
// active spawned sessions for a workflow.
func (p *Plugin) workflowActiveSpawnCount(orgID int64, name string) (int, error) {
	if p.redisClient == nil {
		return 0, fmt.Errorf("redis is not configured")
	}
	ctx, cancel := redisContext(p.ctx, RedisOpTimeout)
	defer cancel()
	key := workflowActiveSpawnKey(orgID, name)
	if err := p.redisClient.ZRemRangeByScore(ctx, key, "-inf", fmt.Sprintf("%d", time.Now().Unix())).Err(); err != nil {
		return 0, err
	}
	card, err := p.redisClient.ZCard(ctx, key).Result()
	if err != nil {
		return 0, err
	}
	return int(card), nil
}

// workflowActiveSpawnRefreshGauge syncs the metric with the stored count plus
// this instance's in-flight top-level runs. Best effort: a Redis hiccup
// leaves the previous value in place.
func (p *Plugin) workflowActiveSpawnRefreshGauge(orgID int64, name string) {
	count, err := p.workflowActiveSpawnCount(orgID, name)
	if err != nil {
		return
	}
	workflowActiveSpawned.WithLabelValues(workflowLabel(orgID, name)).Set(float64(count + p.workflowTopLevelCount(orgID, name)))
}

// workflowTopLevelKey scopes this instance's in-flight top-level counter by
// org, so the same workflow name in two orgs never shares a count.
func workflowTopLevelKey(orgID int64, name string) string {
	return strconv.FormatInt(orgID, 10) + ":" + name
}

// workflowTopLevelAdd adjusts this instance's in-flight top-level run count
// and re-syncs the active-sessions gauge. Top-level runs are per replica, so
// they are tracked here rather than in the cross-replica spawn set.
func (p *Plugin) workflowTopLevelAdd(orgID int64, name string, delta int) {
	key := workflowTopLevelKey(orgID, name)
	p.workflowTopLevelMu.Lock()
	if p.workflowTopLevel != nil {
		p.workflowTopLevel[key] += delta
		if p.workflowTopLevel[key] <= 0 {
			delete(p.workflowTopLevel, key)
		}
	}
	p.workflowTopLevelMu.Unlock()
	p.workflowActiveSpawnRefreshGauge(orgID, name)
}

// workflowTopLevelCount reports this instance's in-flight top-level runs.
func (p *Plugin) workflowTopLevelCount(orgID int64, name string) int {
	p.workflowTopLevelMu.Lock()
	defer p.workflowTopLevelMu.Unlock()
	return p.workflowTopLevel[workflowTopLevelKey(orgID, name)]
}

// identityWarnInterval bounds how often the unseeded-identity warning fires,
// so an idle org does not fill the log at tick rate.
const identityWarnInterval = 10 * time.Minute

// WorkflowScheduler runs one workflow's tick loop.
type WorkflowScheduler struct {
	ctx    context.Context
	cancel context.CancelFunc
	wg     sync.WaitGroup

	p     *Plugin
	entry WorkflowEntry

	// allowlistChecked defers the unknown-tool validation to the first tick
	// when MCP servers were still connecting at startup.
	allowlistChecked bool
	lastIdentityWarn time.Time
}

func NewWorkflowScheduler(parent context.Context, p *Plugin, entry WorkflowEntry) *WorkflowScheduler {
	ctx, cancel := context.WithCancel(parent)
	return &WorkflowScheduler{ctx: ctx, cancel: cancel, p: p, entry: entry}
}

// Start runs the tick loop in its own goroutine and returns immediately. The
// wait-group registration happens before Start returns, so a concurrent Stop
// cannot reach wg.Wait before the loop is registered: Dispose can rely on Stop
// having waited for the loop once it returns.
func (s *WorkflowScheduler) Start() {
	s.wg.Add(1)
	go s.run()
}

// run is the tick loop Start spawns. Every exit path reaches the single
// wg.Done, so the group count matches the loops that started.
func (s *WorkflowScheduler) run() {
	defer s.wg.Done()
	interval := time.Duration(s.entry.IntervalSec) * time.Second
	s.p.logger.Info("Workflow scheduler started",
		"workflow", s.entry.Name, "intervalSeconds", s.entry.IntervalSec, "skill", s.entry.Skill)
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-s.ctx.Done():
			return
		case <-ticker.C:
			s.tick()
		}
	}
}

// Stopped reports whether this scheduler ended itself (deferred validation
// failure) or was stopped, so status consumers can tell a live scheduler
// from a dead one still held by the manager.
func (s *WorkflowScheduler) Stopped() bool {
	return s.ctx.Err() != nil
}

// Stop ends the loop and waits for an in-flight tick to finish, so Dispose
// can close the MCP proxy and Redis safely afterwards.
func (s *WorkflowScheduler) Stop() {
	s.cancel()
	s.wg.Wait()
}

// resolvedOrgID is the org this scheduler's entry runs for. An entry stamped
// with an org uses it; an unstamped entry (0) falls back to the instance's
// sole bound org, which is the transitional single-org behaviour. With two
// orgs bound and no stamp the answer is 0 (ambiguous), so the tick skips
// rather than run as the wrong org; round B stamps every entry instead.
func (s *WorkflowScheduler) resolvedOrgID() int64 {
	orgID := s.entry.OrgID
	if orgID <= 0 && s.p.orgIdentity != nil {
		if sole, ok := s.p.orgIdentity.SoleOrgID(); ok {
			orgID = sole
		}
	}
	return orgID
}

func (s *WorkflowScheduler) tick() {
	name := s.entry.Name
	orgID := s.resolvedOrgID()
	label := workflowLabel(orgID, name)

	// Removal must never spend another token, even before the reconcile loop
	// notices it: verify the entry still exists in its org's store and still
	// matches the one this scheduler was started with. A stale entry is a
	// counted outcome, not a warning: reconcile stops it shortly.
	if !s.entryStillStored(orgID) {
		workflowTicks.WithLabelValues(label, "skip_stale").Inc()
		s.p.workflowStatus.RecordTick(orgID, name, "skip_stale")
		return
	}

	if !s.allowlistChecked && !s.deferredAllowlistValidation() {
		// Either the tool listing is still empty (retry next tick) or the
		// entry failed validation and this scheduler has stopped itself.
		return
	}

	// Identity before the lock: the org identity is per org and per replica
	// (seeded by the requests that replica served). An unseeded org must not
	// take the tick lock, or a seeded replica would skip the tick as locked
	// and the workflow would never run under sticky-session routing. Only this
	// org is skipped; every other org's tick proceeds.
	grafanaURL, saToken, seeded := "", "", false
	if orgID > 0 && s.p.orgIdentity != nil {
		grafanaURL, saToken, seeded = s.p.orgIdentity.GetForOrg(orgID)
	}
	if !seeded {
		if time.Since(s.lastIdentityWarn) >= identityWarnInterval {
			s.lastIdentityWarn = time.Now()
			s.p.logger.Warn("Workflow tick skipped: org identity not yet seeded for this org; it seeds from the first user request in that org",
				"workflow", name, "orgId", orgID)
		}
		workflowTicks.WithLabelValues(label, "skip_identity").Inc()
		s.p.workflowStatus.RecordTick(orgID, name, "skip_identity")
		return
	}

	ttl := time.Duration(s.entry.IntervalSec/2) * time.Second
	held, err := acquireWorkflowTickLock(s.ctx, s.p.redisClient, orgID, name, ttl)
	if err != nil {
		s.p.logger.Error("Workflow tick skipped: tick lock unavailable", "workflow", name, "orgId", orgID, "error", err)
		workflowTicks.WithLabelValues(label, "skip_error").Inc()
		s.p.workflowStatus.RecordTickError(orgID, name, "tick lock unavailable")
		return
	}
	if !held {
		// Another replica owns this tick. Skipping is the healthy path.
		workflowTicks.WithLabelValues(label, "skip_lock").Inc()
		s.p.workflowStatus.RecordTick(orgID, name, "skip_lock")
		return
	}

	// Bound the top-level runs: a tick only starts a session when no earlier
	// top-level run of this workflow is still in flight. The interval can be
	// far shorter than the session timeout, so without this gate the runs
	// would pile up one per tick. The key is TTL'd, so a dead process cannot
	// deadlock the workflow.
	runID, idErr := generateShareID()
	if idErr != nil {
		s.p.logger.Error("Workflow tick failed to generate a run ID", "workflow", name, "orgId", orgID, "error", idErr)
		s.p.workflowStatus.RecordSessionError(orgID, name, idErr.Error())
		return
	}
	admitted, gateErr := s.p.acquireWorkflowTopLevelRun(orgID, name, runID, s.entry.SessionTimeoutSeconds)
	if gateErr != nil {
		s.p.logger.Error("Workflow tick skipped: top-level active key unavailable", "workflow", name, "orgId", orgID, "error", gateErr)
		workflowTicks.WithLabelValues(label, "skip_error").Inc()
		s.p.workflowStatus.RecordTickError(orgID, name, "top-level active key unavailable")
		return
	}
	if !admitted {
		// A top-level run from an earlier tick still holds the slot. This is
		// the healthy path when the interval is shorter than the run, so it is
		// counted and recorded, not warned about.
		workflowTicks.WithLabelValues(label, "skip_active").Inc()
		s.p.workflowStatus.RecordTick(orgID, name, "skip_active")
		return
	}
	s.p.workflowTopLevelAdd(orgID, name, 1)

	workflowTicks.WithLabelValues(label, "executed").Inc()
	s.p.workflowStatus.RecordTick(orgID, name, "executed")
	if _, _, startErr := s.p.startWorkflowSessionWithID(workflowRunParams{
		entry:         s.entry,
		skill:         s.entry.Skill,
		message:       workflowMessage(s.entry),
		orgID:         orgID,
		grafanaURL:    grafanaURL,
		saToken:       saToken,
		syntheticID:   syntheticWorkflowUserID(name, orgID),
		spawned:       false,
		isFallback:    false,
		topLevelGated: true,
	}, runID); startErr != nil {
		// The failed-session metric is incremented inside; log so the tick is
		// never silently unhealthy. The slot the failed start never used is
		// released here because no finish goroutine will run for it.
		s.p.releaseWorkflowTopLevelRun(orgID, name, runID)
		s.p.logger.Error("Workflow tick failed to start its session", "workflow", name, "orgId", orgID, "error", startErr)
		s.p.workflowStatus.RecordSessionError(orgID, name, startErr.Error())
	}
}

// entryStillStored verifies this scheduler's entry against its org's store
// before a tick. It is true when no org-scoped store applies (a white-box test
// plugin) and false when the entry is gone or changed, or when the store
// cannot be read: an unverifiable entry must not spend a token.
func (s *WorkflowScheduler) entryStillStored(orgID int64) bool {
	if s.p.redisClient == nil || orgID <= 0 {
		return true
	}
	entries, err := s.p.workflowEntryStore().ListWorkflows(s.ctx, orgID)
	if err != nil {
		return false
	}
	for _, stored := range entries {
		if strings.TrimSpace(stored.Name) != s.entry.Name {
			continue
		}
		next := stored
		next.OrgID = orgID
		next.Name = strings.TrimSpace(next.Name)
		next.applyDefaults()
		return sameWorkflowEntry(next, s.entry)
	}
	return false
}

// deferredAllowlistValidation re-validates the entry once tools are listable.
// Returns true when the entry is valid (or already checked); false when this
// tick must not proceed. An unknown allowlist tool only disables the entry
// once every configured MCP server reports healthy — a partial catalog (one
// server still connecting) means the tool may simply not be listed yet, so
// the check retries on later ticks instead of killing the workflow.
func (s *WorkflowScheduler) deferredAllowlistValidation() bool {
	tools, err := s.p.mcpProxy.ListTools()
	if err != nil || len(tools) == 0 {
		// Servers still connecting; retry on the next tick.
		return false
	}
	known := make(map[string]bool, len(tools))
	for _, t := range tools {
		known[t.Name] = true
	}
	if err := validateWorkflowEntry(s.entry, s.p.skillRegistry, known); err != nil {
		if errors.Is(err, errWorkflowUnknownTool) && !s.mcpCatalogStable() {
			s.p.logger.Warn("Workflow allowlist validation deferred: MCP catalog not yet stable",
				"workflow", s.entry.Name, "error", err)
			return false
		}
		s.p.logger.Error("Workflow disabled: invalid configuration", "workflow", s.entry.Name, "error", err)
		workflowTicks.WithLabelValues(workflowLabel(s.resolvedOrgID(), s.entry.Name), "skip_error").Inc()
		s.p.workflowStatus.RecordTickError(s.resolvedOrgID(), s.entry.Name, err.Error())
		s.cancel()
		return false
	}
	s.allowlistChecked = true
	return true
}

// mcpCatalogStable reports whether every monitored MCP server is healthy.
// Only then is a tool listing complete enough to trust an unknown-tool
// verdict; otherwise a missing server could masquerade as a bad allowlist.
func (s *WorkflowScheduler) mcpCatalogStable() bool {
	monitor := s.p.mcpProxy.GetHealthMonitor()
	if monitor == nil {
		return false
	}
	all := monitor.GetAllHealth()
	if len(all) == 0 {
		return false
	}
	for _, h := range all {
		if h.Status != mcp.StatusHealthy {
			return false
		}
	}
	return true
}

// workflowKey identifies one workflow scheduler. The org is part of the key,
// so the same workflow name in two orgs owns two independent schedulers, ticks,
// and run histories.
type workflowKey struct {
	orgID int64
	name  string
}

// WorkflowManager owns this instance's schedulers, one per stored workflow
// entry. It converges on every reconcile: an added entry starts a scheduler, a
// removed or changed entry stops (or restarts) one. Stop ends every scheduler
// and waits for in-flight ticks; an in-flight RUN is owned by the session and
// survives, exactly as it does across a settings-save instance rebuild.
type WorkflowManager struct {
	mu         sync.Mutex
	p          *Plugin
	ctx        context.Context
	schedulers map[workflowKey]*WorkflowScheduler
	entries    map[workflowKey]WorkflowEntry
	// problems is the last refused-entry diagnostic per key, so the 30 second
	// reconcile loop reports a bad stored entry once instead of every pass.
	problems map[workflowKey]string
	stopped  bool
	// generation counts reconcile passes. A pass claims a number before it
	// reads the store, and apply refuses to converge for a pass a newer one
	// has superseded: the stale pass read the list before a hot apply saved
	// the new one, so applying it would restart the old schedulers.
	generation atomic.Int64
}

// newWorkflowManager builds an empty manager whose schedulers inherit parent.
func newWorkflowManager(p *Plugin, parent context.Context) *WorkflowManager {
	return &WorkflowManager{
		p:          p,
		ctx:        parent,
		schedulers: map[workflowKey]*WorkflowScheduler{},
		entries:    map[workflowKey]WorkflowEntry{},
		problems:   map[workflowKey]string{},
	}
}

// Stop ends every scheduler and waits for in-flight ticks. No reconcile can
// start a new scheduler afterwards.
func (m *WorkflowManager) Stop() {
	m.mu.Lock()
	m.stopped = true
	schedulers := make([]*WorkflowScheduler, 0, len(m.schedulers))
	for _, s := range m.schedulers {
		schedulers = append(schedulers, s)
	}
	m.schedulers = map[workflowKey]*WorkflowScheduler{}
	m.entries = map[workflowKey]WorkflowEntry{}
	m.mu.Unlock()
	for _, s := range schedulers {
		s.Stop()
	}
}

// schedulerFor returns the live scheduler of one key, or nil.
func (m *WorkflowManager) schedulerFor(orgID int64, name string) *WorkflowScheduler {
	if m == nil {
		return nil
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.schedulers[workflowKey{orgID: orgID, name: name}]
}

// isRunning reports whether this instance runs a live scheduler for one
// workflow. A scheduler that stopped itself (deferred validation failure) is
// held no longer, so it reports false.
func (m *WorkflowManager) isRunning(orgID int64, name string) bool {
	s := m.schedulerFor(orgID, name)
	return s != nil && !s.Stopped()
}

// beginReconcile claims the next generation for one reconcile pass.
func (m *WorkflowManager) beginReconcile() int64 {
	return m.generation.Add(1)
}

// apply converges the live scheduler set onto desired. readOrgs names the orgs
// whose stored list was read successfully; a scheduler of an org that could
// not be read is left running, so a Redis hiccup never disables a workflow.
//
// gen is the generation the caller claimed with beginReconcile. When a newer
// pass has started, this pass read a list the newer pass has superseded, so
// apply returns without touching a scheduler: the newer pass owns the state.
// The check runs under the lock, so no newer pass can slip between it and the
// convergence below.
func (m *WorkflowManager) apply(gen int64, desired map[workflowKey]WorkflowEntry, readOrgs map[int64]bool, problems map[workflowKey]string, logger log.Logger) {
	m.mu.Lock()
	if m.stopped || m.generation.Load() != gen {
		latest := m.generation.Load()
		m.mu.Unlock()
		logger.Debug("Workflow reconcile superseded by a newer pass; apply skipped",
			"generation", gen, "latest", latest)
		return
	}

	// Stop waits for an in-flight tick, so no Stop call may run under m.mu: a
	// concurrent GET or PUT would block for up to one tick. The manager's own
	// Stop uses the same shape. Cancel under the lock (cheap and
	// non-blocking, so the old scheduler cannot start another tick) and join
	// the schedulers after the unlock.
	stopping := make([]*WorkflowScheduler, 0, len(m.schedulers))
	for key, scheduler := range m.schedulers {
		if !readOrgs[key.orgID] {
			continue
		}
		next, keep := desired[key]
		if keep && sameWorkflowEntry(m.entries[key], next) && !scheduler.Stopped() {
			continue
		}
		// Stop waits only for an in-flight tick. A run the tick already
		// started continues under its own session and lands its record.
		scheduler.cancel()
		stopping = append(stopping, scheduler)
		delete(m.schedulers, key)
		delete(m.entries, key)
		if keep {
			logger.Info("Workflow scheduler restarting: entry changed",
				"workflow", key.name, "orgId", key.orgID)
		} else {
			logger.Info("Workflow scheduler stopped: entry removed",
				"workflow", key.name, "orgId", key.orgID)
		}
	}

	for key, entry := range desired {
		if _, running := m.schedulers[key]; running {
			continue
		}
		scheduler := NewWorkflowScheduler(m.ctx, m.p, entry)
		m.schedulers[key] = scheduler
		m.entries[key] = entry
		logger.Info("Workflow scheduler started",
			"workflow", entry.Name, "orgId", key.orgID,
			"intervalSeconds", entry.IntervalSec, "skill", entry.Skill)
		scheduler.Start()
	}

	// Report each refused entry once, and report recovery when it returns.
	for key, problem := range problems {
		if m.problems[key] == problem {
			continue
		}
		m.problems[key] = problem
		logger.Error("Workflow entry disabled: invalid configuration",
			"workflow", key.name, "orgId", key.orgID, "error", problem)
	}
	for key := range m.problems {
		if _, stillRefused := problems[key]; stillRefused {
			continue
		}
		delete(m.problems, key)
	}
	m.mu.Unlock()

	for _, scheduler := range stopping {
		scheduler.Stop()
	}
}

// sameWorkflowEntry reports whether two prepared entries are identical. Any
// field difference restarts the scheduler, because every field changes how the
// next tick behaves.
func sameWorkflowEntry(a, b WorkflowEntry) bool {
	return reflect.DeepEqual(a, b)
}

// workflowReconcileInterval is how often a replica re-reads the store. It is
// the convergence bound after an out-of-band edit to Redis; a route save
// reconciles immediately.
const workflowReconcileInterval = 30 * time.Second

// workflowReconcileLoop re-runs the reconcile on a fixed interval so replicas
// converge without pub/sub.
func (p *Plugin) workflowReconcileLoop(ctx context.Context) {
	ticker := time.NewTicker(workflowReconcileInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			p.reconcileWorkflows(ctx)
		case <-ctx.Done():
			return
		}
	}
}

// reconcileWorkflows converges this instance's schedulers onto the per-org
// store. It returns every stored entry, the orgs whose list could not be read,
// and ok=false when the store could not be read at all: the caller must not
// treat an unreadable store as "no workflows".
//
// An org in unreadable was enumerated but its record failed to decode. Its
// schedulers are left running and its shares are never diffed for removal: a
// failed read is not an empty list.
//
// The org set comes from SCAN over the store prefix. The applied-set keys share
// that prefix but their suffix is not numeric, so they are skipped.
//
// A pass that a newer pass supersedes before it applies converges nothing: the
// newer pass, which started after this one, applies the fresher list.
func (p *Plugin) reconcileWorkflows(ctx context.Context) ([]WorkflowEntry, map[int64]bool, bool) {
	mgr := p.workflows
	unreadable := map[int64]bool{}
	if mgr == nil {
		return nil, unreadable, false
	}
	if !p.usingRedis || p.redisClient == nil {
		// Entries live in Redis; without it there is nothing to reconcile.
		return nil, unreadable, true
	}

	// Claim this pass before the first store read. A pass that a hot apply
	// supersedes mid-read must not apply its stale snapshot: the newer pass
	// applies the list the save persisted.
	generation := mgr.beginReconcile()

	orgIDs, err := p.workflowStoreOrgs(ctx)
	if err != nil {
		p.logger.Warn("Workflow reconcile skipped: cannot list orgs", "error", err)
		return nil, unreadable, false
	}

	allowlistTools := make(map[string]bool)
	if tools, err := p.mcpProxy.ListTools(); err == nil {
		for _, t := range tools {
			allowlistTools[t.Name] = true
		}
	}

	desired := make(map[workflowKey]WorkflowEntry)
	readOrgs := make(map[int64]bool, len(orgIDs))
	problems := make(map[workflowKey]string)
	var all []WorkflowEntry
	for _, orgID := range orgIDs {
		entries, listErr := p.workflowEntryStore().ListWorkflows(ctx, orgID)
		if listErr != nil {
			p.logger.Warn("Workflow reconcile skipped one org: entry list unreadable",
				"orgId", orgID, "error", listErr)
			unreadable[orgID] = true
			continue
		}
		readOrgs[orgID] = true
		all = append(all, entries...)
		valid, refused := prepareWorkflowEntries(entries, orgID, p.skillRegistry, allowlistTools)
		for _, entry := range valid {
			desired[workflowKey{orgID: orgID, name: entry.Name}] = entry
		}
		for _, problem := range refused {
			problems[workflowKey{orgID: orgID, name: problem.Name}] = problem.Error
		}
	}

	mgr.apply(generation, desired, readOrgs, problems, p.logger)
	return all, unreadable, true
}

// workflowStoreOrgs lists every org with a stored workflow list.
func (p *Plugin) workflowStoreOrgs(ctx context.Context) ([]int64, error) {
	if p.redisClient == nil {
		return nil, fmt.Errorf("workflow store requires Redis")
	}
	scanCtx, cancel := redisContext(ctx, RedisBulkOpTimeout)
	defer cancel()
	var orgIDs []int64
	seen := map[int64]bool{}
	iter := p.redisClient.Scan(scanCtx, 0, workflowStoreKeyPrefix+"*", 100).Iterator()
	for iter.Next(scanCtx) {
		suffix, ok := strings.CutPrefix(iter.Val(), workflowStoreKeyPrefix)
		if !ok {
			continue
		}
		orgID, err := strconv.ParseInt(suffix, 10, 64)
		if err != nil || orgID <= 0 || seen[orgID] {
			continue
		}
		seen[orgID] = true
		orgIDs = append(orgIDs, orgID)
	}
	if err := iter.Err(); err != nil {
		return nil, err
	}
	return orgIDs, nil
}
