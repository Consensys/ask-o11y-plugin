package plugin

import (
	"context"
	"errors"
	"fmt"
	"hash/fnv"
	"sync"
	"time"

	"consensys-asko11y-app/pkg/mcp"

	"github.com/redis/go-redis/v9"
)

// syntheticUserIDDomain prefixes every hashed synthetic (non-Grafana) user
// ID. The leading NUL byte cannot appear in a Grafana login, so a real login
// can never hash into the synthetic namespace, even a login literally named
// "workflow:<name>".
const syntheticUserIDDomain = "\x00workflow:"

// fnvSyntheticUserID derives the stable synthetic user ID for a workflow
// name. It uses the same FNV64a scheme as getUserID, over an input domain
// that no real Grafana login can occupy.
func fnvSyntheticUserID(workflow string) int64 {
	h := fnv.New64a()
	h.Write([]byte(syntheticUserIDDomain + workflow))
	return int64(h.Sum64() & 0x7FFFFFFFFFFFFFFF)
}

// workflowTickLockKey is the Redis key electing one replica per tick.
func workflowTickLockKey(name string) string { return "workflow:" + name + ":tick" }

// workflowActiveSpawnKey is the Redis ZSET counting active spawned sessions
// across replicas. Members are run IDs; scores are watchdog deadlines, so a
// member whose deadline passed is pruned on read and never blocks a spawn.
func workflowActiveSpawnKey(name string) string { return "workflow:" + name + ":active" }

// workflowTopLevelActiveKey is the Redis key electing one in-flight top-level
// run per workflow. The value is the owning run ID. It is separate from the
// tick lock (:tick) and the spawned-session set (:active): ticks may fire
// while a top-level run from an earlier tick is still working, and only this
// key bounds those runs.
func workflowTopLevelActiveKey(name string) string { return "workflow:" + name + ":toplevel" }

// workflowTopLevelActiveMargin extends the top-level key TTL past the run's
// own deadline, so a process that dies mid-run cannot deadlock the workflow:
// the key expires and the next tick proceeds.
const workflowTopLevelActiveMargin = 60 * time.Second

// acquireWorkflowTopLevelRun claims the one top-level slot of a workflow for
// runID. A held key means another top-level run is still in flight; the caller
// skips the tick instead of piling up a concurrent run.
func (p *Plugin) acquireWorkflowTopLevelRun(name, runID string, timeoutSeconds int) (bool, error) {
	if p.redisClient == nil {
		// No Redis: workflows only run single-instance, and the in-process
		// tracker already bounds this instance's runs. Nothing to gate.
		return true, nil
	}
	ttl := time.Duration(timeoutSeconds)*time.Second + workflowTopLevelActiveMargin
	ctx, cancel := redisContext(p.ctx, RedisOpTimeout)
	defer cancel()
	return p.redisClient.SetNX(ctx, workflowTopLevelActiveKey(name), runID, ttl).Result()
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
func (p *Plugin) releaseWorkflowTopLevelRun(name, runID string) {
	if p.redisClient != nil {
		ctx, cancel := redisContext(p.ctx, RedisOpTimeout)
		if err := workflowTopLevelReleaseScript.Run(ctx, p.redisClient,
			[]string{workflowTopLevelActiveKey(name)}, runID).Err(); err != nil {
			p.logger.Warn("Workflow top-level key release failed", "workflow", name, "error", err)
		}
		cancel()
	}
	p.workflowTopLevelAdd(name, -1)
}

// acquireWorkflowTickLock elects this instance for one tick. The TTL is half
// the interval at most, so a crashed holder cannot starve the survivors.
func acquireWorkflowTickLock(ctx context.Context, client *redis.Client, name string, ttl time.Duration) (bool, error) {
	lockCtx, cancel := redisContext(ctx, RedisOpTimeout)
	defer cancel()
	return client.SetNX(lockCtx, workflowTickLockKey(name), "1", ttl).Result()
}

// workflowActiveSpawnAdd records a spawned session in the active set with its
// watchdog deadline as the score.
func (p *Plugin) workflowActiveSpawnAdd(name, runID string, deadline time.Time) error {
	if p.redisClient == nil {
		return fmt.Errorf("redis is not configured")
	}
	ctx, cancel := redisContext(p.ctx, RedisOpTimeout)
	defer cancel()
	return p.redisClient.ZAdd(ctx, workflowActiveSpawnKey(name), redis.Z{
		Score:  float64(deadline.Unix()),
		Member: runID,
	}).Err()
}

// workflowActiveSpawnRemove drops a finished spawned session from the active
// set. The gauge follows the surviving count so operators see the true
// in-flight number even after a prune.
func (p *Plugin) workflowActiveSpawnRemove(name, runID string) {
	if p.redisClient == nil {
		return
	}
	ctx, cancel := redisContext(p.ctx, RedisOpTimeout)
	defer cancel()
	if err := p.redisClient.ZRem(ctx, workflowActiveSpawnKey(name), runID).Err(); err != nil {
		p.logger.Warn("Workflow active-set remove failed", "workflow", name, "error", err)
	}
	p.workflowActiveSpawnRefreshGauge(name)
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
func (p *Plugin) workflowActiveSpawnTryAdd(name, runID string, deadline time.Time, cap int) (bool, error) {
	if p.redisClient == nil {
		return false, fmt.Errorf("redis is not configured")
	}
	ctx, cancel := redisContext(p.ctx, RedisOpTimeout)
	defer cancel()
	res, err := workflowSpawnTryAddScript.Run(ctx, p.redisClient,
		[]string{workflowActiveSpawnKey(name)},
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
func (p *Plugin) workflowActiveSpawnCount(name string) (int, error) {
	if p.redisClient == nil {
		return 0, fmt.Errorf("redis is not configured")
	}
	ctx, cancel := redisContext(p.ctx, RedisOpTimeout)
	defer cancel()
	key := workflowActiveSpawnKey(name)
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
func (p *Plugin) workflowActiveSpawnRefreshGauge(name string) {
	count, err := p.workflowActiveSpawnCount(name)
	if err != nil {
		return
	}
	workflowActiveSpawned.WithLabelValues(workflowLabel(name)).Set(float64(count + p.workflowTopLevelCount(name)))
}

// workflowTopLevelAdd adjusts this instance's in-flight top-level run count
// and re-syncs the active-sessions gauge. Top-level runs are per replica, so
// they are tracked here rather than in the cross-replica spawn set.
func (p *Plugin) workflowTopLevelAdd(name string, delta int) {
	p.workflowTopLevelMu.Lock()
	if p.workflowTopLevel != nil {
		p.workflowTopLevel[name] += delta
		if p.workflowTopLevel[name] <= 0 {
			delete(p.workflowTopLevel, name)
		}
	}
	p.workflowTopLevelMu.Unlock()
	p.workflowActiveSpawnRefreshGauge(name)
}

// workflowTopLevelCount reports this instance's in-flight top-level runs.
func (p *Plugin) workflowTopLevelCount(name string) int {
	p.workflowTopLevelMu.Lock()
	defer p.workflowTopLevelMu.Unlock()
	return p.workflowTopLevel[name]
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

// Start runs the tick loop. Call in a goroutine.
func (s *WorkflowScheduler) Start() {
	s.wg.Add(1)
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

func (s *WorkflowScheduler) tick() {
	name := s.entry.Name
	label := workflowLabel(name)

	if !s.allowlistChecked && !s.deferredAllowlistValidation() {
		// Either the tool listing is still empty (retry next tick) or the
		// entry failed validation and this scheduler has stopped itself.
		return
	}

	// Identity before the lock: the org identity is per replica (seeded by
	// the requests that replica served). An unseeded holder must not take
	// the tick lock, or the seeded replica would skip the tick as locked and
	// the workflow would never run under sticky-session routing.
	orgID, grafanaURL, saToken, seeded := s.p.orgIdentity.Get()
	if !seeded {
		if time.Since(s.lastIdentityWarn) >= identityWarnInterval {
			s.lastIdentityWarn = time.Now()
			s.p.logger.Warn("Workflow tick skipped: org identity not yet seeded; it seeds from the first user request in this instance",
				"workflow", name)
		}
		workflowTicks.WithLabelValues(label, "skip_identity").Inc()
		s.p.workflowStatus.RecordTick(name, "skip_identity")
		return
	}

	ttl := time.Duration(s.entry.IntervalSec/2) * time.Second
	held, err := acquireWorkflowTickLock(s.ctx, s.p.redisClient, name, ttl)
	if err != nil {
		s.p.logger.Error("Workflow tick skipped: tick lock unavailable", "workflow", name, "error", err)
		workflowTicks.WithLabelValues(label, "skip_error").Inc()
		s.p.workflowStatus.RecordTickError(name, "tick lock unavailable")
		return
	}
	if !held {
		// Another replica owns this tick. Skipping is the healthy path.
		workflowTicks.WithLabelValues(label, "skip_lock").Inc()
		s.p.workflowStatus.RecordTick(name, "skip_lock")
		return
	}

	// Bound the top-level runs: a tick only starts a session when no earlier
	// top-level run of this workflow is still in flight. The interval can be
	// far shorter than the session timeout, so without this gate the runs
	// would pile up one per tick. The key is TTL'd, so a dead process cannot
	// deadlock the workflow.
	runID, idErr := generateShareID()
	if idErr != nil {
		s.p.logger.Error("Workflow tick failed to generate a run ID", "workflow", name, "error", idErr)
		s.p.workflowStatus.RecordSessionError(name, idErr.Error())
		return
	}
	admitted, gateErr := s.p.acquireWorkflowTopLevelRun(name, runID, s.entry.SessionTimeoutSeconds)
	if gateErr != nil {
		s.p.logger.Error("Workflow tick skipped: top-level active key unavailable", "workflow", name, "error", gateErr)
		workflowTicks.WithLabelValues(label, "skip_error").Inc()
		s.p.workflowStatus.RecordTickError(name, "top-level active key unavailable")
		return
	}
	if !admitted {
		// A top-level run from an earlier tick still holds the slot. This is
		// the healthy path when the interval is shorter than the run, so it is
		// counted and recorded, not warned about.
		workflowTicks.WithLabelValues(label, "skip_active").Inc()
		s.p.workflowStatus.RecordTick(name, "skip_active")
		return
	}
	s.p.workflowTopLevelAdd(name, 1)

	workflowTicks.WithLabelValues(label, "executed").Inc()
	s.p.workflowStatus.RecordTick(name, "executed")
	if _, _, startErr := s.p.startWorkflowSessionWithID(workflowRunParams{
		entry:         s.entry,
		skill:         s.entry.Skill,
		message:       workflowMessage(s.entry),
		orgID:         orgID,
		grafanaURL:    grafanaURL,
		saToken:       saToken,
		syntheticID:   syntheticWorkflowUserID(name),
		spawned:       false,
		isFallback:    false,
		topLevelGated: true,
	}, runID); startErr != nil {
		// The failed-session metric is incremented inside; log so the tick is
		// never silently unhealthy. The slot the failed start never used is
		// released here because no finish goroutine will run for it.
		s.p.releaseWorkflowTopLevelRun(name, runID)
		s.p.logger.Error("Workflow tick failed to start its session", "workflow", name, "error", startErr)
		s.p.workflowStatus.RecordSessionError(name, startErr.Error())
	}
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
		workflowTicks.WithLabelValues(workflowLabel(s.entry.Name), "skip_error").Inc()
		s.p.workflowStatus.RecordTickError(s.entry.Name, err.Error())
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

// WorkflowManager owns all schedulers for one plugin instance.
type WorkflowManager struct {
	schedulers []*WorkflowScheduler
}

// Stop ends every scheduler and waits for in-flight ticks.
func (m *WorkflowManager) Stop() {
	for _, s := range m.schedulers {
		s.Stop()
	}
}

// startWorkflows validates the configured entries and starts a scheduler per
// valid, enabled one. Requires Redis: the tick lock and the cross-replica
// spawn caps both live there.
func (p *Plugin) startWorkflows(entries []WorkflowEntry) {
	if !p.usingRedis || p.redisClient == nil {
		p.logger.Error("Workflows require Redis; every workflow entry is disabled",
			"entries", len(entries))
		return
	}
	// Best-effort tool listing at startup: servers may still be connecting,
	// in which case the per-scheduler deferred check covers the allowlist.
	allowlistTools := map[string]bool{}
	if tools, err := p.mcpProxy.ListTools(); err == nil {
		for _, t := range tools {
			allowlistTools[t.Name] = true
		}
	}
	valid := prepareWorkflows(entries, p.skillRegistry, allowlistTools, p.logger)
	if len(valid) == 0 {
		return
	}
	mgr := &WorkflowManager{}
	for _, entry := range valid {
		scheduler := NewWorkflowScheduler(p.ctx, p, entry)
		mgr.schedulers = append(mgr.schedulers, scheduler)
		go scheduler.Start()
	}
	p.workflows = mgr
}
