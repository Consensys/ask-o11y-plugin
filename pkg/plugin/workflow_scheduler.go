package plugin

import (
	"context"
	"fmt"
	"hash/fnv"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
)

// fnvSyntheticUserID derives a stable non-grafana user ID from a login-like
// string, using the same scheme as getUserID for interactive users.
func fnvSyntheticUserID(login string) int64 {
	h := fnv.New64a()
	h.Write([]byte(login))
	return int64(h.Sum64() & 0x7FFFFFFFFFFFFFFF)
}

// workflowTickLockKey is the Redis key electing one replica per tick.
func workflowTickLockKey(name string) string { return "workflow:" + name + ":tick" }

// workflowActiveSpawnKey is the Redis ZSET counting active spawned sessions
// across replicas. Members are run IDs; scores are watchdog deadlines, so a
// member whose deadline passed is pruned on read and never blocks a spawn.
func workflowActiveSpawnKey(name string) string { return "workflow:" + name + ":active" }

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
	return int(p.redisClient.ZCard(ctx, key).Val()), nil
}

// workflowActiveSpawnRefreshGauge syncs the metric with the stored count.
// Best effort: a Redis hiccup leaves the previous value in place.
func (p *Plugin) workflowActiveSpawnRefreshGauge(name string) {
	count, err := p.workflowActiveSpawnCount(name)
	if err != nil {
		return
	}
	workflowActiveSpawned.WithLabelValues(workflowLabel(name)).Set(float64(count))
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

	ttl := time.Duration(s.entry.IntervalSec/2) * time.Second
	held, err := acquireWorkflowTickLock(s.ctx, s.p.redisClient, name, ttl)
	if err != nil {
		s.p.logger.Error("Workflow tick skipped: tick lock unavailable", "workflow", name, "error", err)
		workflowTicks.WithLabelValues(label, "skip_error").Inc()
		return
	}
	if !held {
		// Another replica owns this tick. Skipping is the healthy path.
		workflowTicks.WithLabelValues(label, "skip_lock").Inc()
		return
	}

	grafanaURL, saToken, seeded := s.p.orgIdentity.Get(s.entry.OrgID)
	if !seeded {
		if time.Since(s.lastIdentityWarn) >= identityWarnInterval {
			s.lastIdentityWarn = time.Now()
			s.p.logger.Warn("Workflow tick skipped: org identity not yet seeded; it seeds from the first user request in this org",
				"workflow", name, "orgId", s.entry.OrgID)
		}
		workflowTicks.WithLabelValues(label, "skip_identity").Inc()
		return
	}

	workflowTicks.WithLabelValues(label, "executed").Inc()
	s.p.startWorkflowSession(workflowRunParams{
		entry:       s.entry,
		skill:       s.entry.Skill,
		message:     workflowMessage(s.entry),
		grafanaURL:  grafanaURL,
		saToken:     saToken,
		syntheticID: syntheticWorkflowUserID(name),
		spawned:     false,
		isFallback:  false,
	})
}

// deferredAllowlistValidation re-validates the entry once tools are listable.
// Returns true when the entry is valid (or already checked); false when this
// tick must not proceed — including when validation failed and the scheduler
// stopped itself.
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
		s.p.logger.Error("Workflow disabled: invalid configuration", "workflow", s.entry.Name, "error", err)
		workflowTicks.WithLabelValues(workflowLabel(s.entry.Name), "skip_error").Inc()
		s.cancel()
		return false
	}
	s.allowlistChecked = true
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
