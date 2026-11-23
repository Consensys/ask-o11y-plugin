package plugin

import (
	"context"
	"testing"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	"github.com/prometheus/client_golang/prometheus/testutil"
	"github.com/redis/go-redis/v9"
)

// workflowRedisTestClient returns a client for the dev Redis test database,
// skipping the test when Redis is unavailable (the house pattern).
func workflowRedisTestClient(t *testing.T) *redis.Client {
	t.Helper()
	client, err := createRedisClient(log.DefaultLogger, "redis://localhost:6379/15")
	if err != nil {
		t.Skipf("Redis not available: %v", err)
	}
	if pingErr := client.Ping(context.Background()).Err(); pingErr != nil {
		client.Close()
		t.Skipf("Redis not available: %v", pingErr)
	}
	return client
}

func TestAcquireWorkflowTickLockElectsOneHolder(t *testing.T) {
	client := workflowRedisTestClient(t)
	defer client.Close()

	ctx := context.Background()
	if err := client.Del(ctx, workflowTickLockKey(1, "lock-wf")).Err(); err != nil {
		t.Fatalf("cleanup failed: %v", err)
	}

	held, err := acquireWorkflowTickLock(ctx, client, 1, "lock-wf", time.Minute)
	if err != nil || !held {
		t.Fatalf("first acquisition must win: held=%v err=%v", held, err)
	}
	held, err = acquireWorkflowTickLock(ctx, client, 1, "lock-wf", time.Minute)
	if err != nil || held {
		t.Fatalf("second acquisition must lose while held: held=%v err=%v", held, err)
	}
}

func TestAcquireWorkflowTickLockExpiresWithTTL(t *testing.T) {
	client := workflowRedisTestClient(t)
	defer client.Close()

	ctx := context.Background()
	if err := client.Del(ctx, workflowTickLockKey(1, "ttl-wf")).Err(); err != nil {
		t.Fatalf("cleanup failed: %v", err)
	}

	held, _ := acquireWorkflowTickLock(ctx, client, 1, "ttl-wf", 200*time.Millisecond)
	if !held {
		t.Fatal("first acquisition must win")
	}
	time.Sleep(350 * time.Millisecond)
	held, err := acquireWorkflowTickLock(ctx, client, 1, "ttl-wf", 200*time.Millisecond)
	if err != nil || !held {
		t.Fatalf("lock must free after its TTL: held=%v err=%v", held, err)
	}
}

func TestWorkflowActiveSpawnSetLifecycle(t *testing.T) {
	client := workflowRedisTestClient(t)
	defer client.Close()

	p := &Plugin{logger: log.DefaultLogger, redisClient: client, ctx: context.Background()}
	name := "spawnset-wf"
	if err := client.Del(p.ctx, workflowActiveSpawnKey(1, name)).Err(); err != nil {
		t.Fatalf("cleanup failed: %v", err)
	}

	deadline := time.Now().Add(time.Minute)
	if err := p.workflowActiveSpawnAdd(1, name, "run-1", deadline); err != nil {
		t.Fatalf("add failed: %v", err)
	}
	// An expired member: its deadline already passed, so it must be pruned.
	if err := p.workflowActiveSpawnAdd(1, name, "run-stale", time.Now().Add(-time.Minute)); err != nil {
		t.Fatalf("add failed: %v", err)
	}

	count, err := p.workflowActiveSpawnCount(1, name)
	if err != nil {
		t.Fatalf("count failed: %v", err)
	}
	if count != 1 {
		t.Fatalf("expired members must be pruned; active=%d", count)
	}

	p.workflowActiveSpawnRemove(1, name, "run-1")
	count, err = p.workflowActiveSpawnCount(1, name)
	if err != nil || count != 0 {
		t.Fatalf("removed member must be gone: count=%d err=%v", count, err)
	}
}

// TestLegacyWorkflowSettingsAreIgnored covers the settings migration: a
// jsonData.workflows value is read only to report its entry count. It starts
// no scheduler — neither with nor without Redis — and the settings type no
// longer carries the field at all.
func TestLegacyWorkflowSettingsAreIgnored(t *testing.T) {
	raw := []byte(`{"workflows": [
		{"name": "legacy-wf", "enabled": true, "orgId": 1, "skill": "wf-skill", "toolAllowlist": ["t_a"]}
	]}`)
	if count, present := legacyWorkflowEntryCount(raw); !present || count != 1 {
		t.Fatalf("legacy settings must report one entry: present=%v count=%d", present, count)
	}
	if count, present := legacyWorkflowEntryCount([]byte(`{"mcpServers":[]}`)); present || count != 0 {
		t.Fatalf("absent key must not report a legacy setting: present=%v count=%d", present, count)
	}

	// Point at a port where nothing listens, so the plugin falls back to
	// in-memory storage. Nothing may start from the legacy key either way.
	settings := backend.AppInstanceSettings{
		JSONData:                raw,
		DecryptedSecureJSONData: map[string]string{"redisURL": "redis://localhost:9999/0"},
	}

	instance, err := NewPlugin(context.Background(), settings)
	if err != nil {
		t.Fatalf("NewPlugin failed: %v", err)
	}
	p := instance.(*Plugin)
	defer p.Dispose()

	if p.usingRedis {
		t.Fatal("test requires the no-Redis fallback path")
	}
	if p.workflows == nil {
		t.Fatal("the manager must exist even when no workflow is configured")
	}
	if got := len(p.workflows.schedulers); got != 0 {
		t.Fatalf("legacy settings must start no scheduler, got %d", got)
	}
}

// TestReconcileStartsOnlyValidEntries seeds one valid and one invalid stored
// entry, then boots a plugin: the initial reconcile starts exactly the valid
// one, and the legacy settings list is irrelevant.
func TestReconcileStartsOnlyValidEntries(t *testing.T) {
	probe := workflowRedisTestClient(t)
	url := "redis://localhost:6379/15"
	if err := probe.FlushDB(context.Background()).Err(); err != nil {
		t.Fatalf("flush failed: %v", err)
	}
	t.Cleanup(func() { probe.FlushDB(context.Background()) })

	const orgID = int64(4242)
	valid := validWorkflowEntry()
	valid.Name = "good-wf"
	valid.Skill = "wf-good"
	bad := validWorkflowEntry()
	bad.Name = "bad-wf"
	bad.Skill = "missing"
	store := NewWorkflowStore(probe, context.Background(), log.DefaultLogger)
	if err := store.SaveWorkflows(context.Background(), orgID, []WorkflowEntry{valid, bad}); err != nil {
		t.Fatalf("store seed failed: %v", err)
	}
	probe.Close() // probe only; NewPlugin opens its own client

	settings := backend.AppInstanceSettings{
		JSONData: []byte(`{
			"mcpServers": [],
			"skills": {"entries": {"wf-good": {"content": "---\nname: wf-good\ndescription: test.\n---\nBody"}}}
		}`),
		DecryptedSecureJSONData: map[string]string{"redisURL": url},
	}

	instance, err := NewPlugin(context.Background(), settings)
	if err != nil {
		t.Fatalf("NewPlugin failed: %v", err)
	}
	p := instance.(*Plugin)
	defer p.Dispose()

	if !p.usingRedis {
		t.Skip("Redis became unavailable between probe and plugin start")
	}
	if p.workflows == nil {
		t.Fatal("the manager must exist")
	}
	if got := len(p.workflows.schedulers); got != 1 {
		t.Fatalf("exactly the valid entry must run, got %d", got)
	}
	if s := p.workflows.schedulerFor(orgID, "good-wf"); s == nil {
		t.Fatal("the valid entry's scheduler must be keyed by its stored org")
	}
	if s := p.workflows.schedulerFor(orgID, "bad-wf"); s != nil {
		t.Fatal("an invalid entry must not start a scheduler")
	}
}

// TestWorkflowTickSurvivesSettingsSave covers per-org identity across an
// instance rebuild. Round A no longer pre-loads a single record in NewPlugin:
// a fresh instance's store is empty, and a tick whose entry carries the org
// stamp resolves it through GetForOrg's Redis read-through into the record the
// earlier instance persisted for that org.
func TestWorkflowTickSurvivesSettingsSave(t *testing.T) {
	client := workflowRedisTestClient(t)
	defer client.Close()
	ctx := context.Background()

	entry := validWorkflowEntry()
	entry.Name = "save-survive-wf"
	entry.Skill = "dispatch"
	entry.IntervalSec = 120
	entry.OrgID = 1

	t.Cleanup(func() {
		// The run store is Redis db 15 indexed under a stable synthetic user
		// ID, so without this flush a second suite run sees this test's stale
		// run records and fails its exact-count assertions.
		client.FlushDB(context.Background())
	})

	// The entry lives in org 1's store now; the ticking scheduler verifies it
	// against that store on every tick.
	if err := NewWorkflowStore(client, ctx, log.DefaultLogger).SaveWorkflows(ctx, 1, []WorkflowEntry{entry}); err != nil {
		t.Fatalf("store seed failed: %v", err)
	}

	tick := func(p *Plugin, e WorkflowEntry) {
		scheduler := NewWorkflowScheduler(p.ctx, p, e)
		// The allowlist check is deferred to ticks with a live tool listing;
		// an empty proxy lists nothing, so simulate the check having passed.
		scheduler.allowlistChecked = true
		scheduler.tick()
	}

	// First instance: a human request seeds and persists org 1's identity.
	before, grafanaURL := newWorkflowTestPlugin(t, stubLLMFinalAnswer("tick ok"))
	before.redisClient = client
	before.usingRedis = true
	before.orgIdentity.attachRedis(client, ctx, log.DefaultLogger)
	before.seedOrgIdentity(1, grafanaURL, "sa-token")
	tick(before, entry)

	syntheticID := syntheticWorkflowUserID(entry.Name, 1)
	runsBefore, err := before.runStore.ListRuns(syntheticID, 1, 50)
	if err != nil || len(runsBefore) != 1 {
		t.Fatalf("seeded tick must start exactly one run: runs=%d err=%v", len(runsBefore), err)
	}

	// Settings save: NewPlugin builds a fresh instance against the same Redis.
	// The previous tick's lock is still held (TTL is half the interval), so
	// clear it as a later interval would.
	if err := client.Del(ctx, workflowTickLockKey(1, entry.Name)).Err(); err != nil {
		t.Fatalf("lock cleanup failed: %v", err)
	}
	instance, err := NewPlugin(ctx, backend.AppInstanceSettings{
		JSONData: []byte(`{
			"mcpServers": [],
			"skills": {"entries": {"dispatch": {"content": "---\nname: dispatch\ndescription: test.\n---\nBody"}}}
		}`),
		DecryptedSecureJSONData: map[string]string{"redisURL": "redis://localhost:6379/15"},
	})
	if err != nil {
		t.Fatalf("NewPlugin after settings save failed: %v", err)
	}
	after := instance.(*Plugin)
	defer after.Dispose()

	if after.usingRedis != true {
		t.Skip("Redis became unavailable between probe and plugin start")
	}
	// Each org's identity is persisted under its own key; the fresh store is
	// empty in memory and resolves the record only on demand.
	if _, _, ok := after.orgIdentity.GetForOrg(1); !ok {
		t.Fatal("the fresh instance must resolve org 1 through the per-org record")
	}
	// Round B stamps the entry with the requesting org at route time; this
	// tick carries that stamp explicitly.
	tick(after, entry)

	if got := after.workflowStatus.entry(entry.Name).LastTickOutcome; got != "executed" {
		t.Fatalf("tick after a settings save must run, not skip: outcome %q", got)
	}
	runsAfter, err := after.runStore.ListRuns(syntheticID, 1, 50)
	if err != nil || len(runsAfter) != 1 {
		t.Fatalf("tick after a settings save must produce a new run record: runs=%d err=%v", len(runsAfter), err)
	}
}

// newTopLevelTickHarness builds a plugin whose tick path is fully wired
// against dev Redis and whose org identity is already seeded.
func newTopLevelTickHarness(t *testing.T, name string) (*Plugin, WorkflowEntry, *redis.Client) {
	t.Helper()
	client := workflowRedisTestClient(t)
	t.Cleanup(func() { client.Close() })
	cleanup := func() {
		client.Del(context.Background(), workflowTopLevelActiveKey(1, name), workflowTickLockKey(1, name),
			orgIdentityRedisKey(1), workflowStoreKey(1))
	}
	cleanup()
	t.Cleanup(cleanup)

	entry := validWorkflowEntry()
	entry.Name = name
	entry.OrgID = 1
	entry.Skill = "dispatch"
	entry.IntervalSec = 120
	entry.SessionTimeoutSeconds = 60

	// The tick verifies its entry against the org store, so seed it there.
	if err := NewWorkflowStore(client, context.Background(), log.DefaultLogger).SaveWorkflows(
		context.Background(), 1, []WorkflowEntry{entry}); err != nil {
		t.Fatalf("store seed failed: %v", err)
	}

	p, grafanaURL := newWorkflowTestPlugin(t, stubLLMFinalAnswer("tick ok"))
	p.redisClient = client
	p.usingRedis = true
	p.workflowTopLevel = make(map[string]int)
	p.orgIdentity.attachRedis(client, p.ctx, log.DefaultLogger)
	p.seedOrgIdentity(1, grafanaURL, "sa-token")
	return p, entry, client
}

// TestTickSkippedWhileTopLevelActive is the refutation for S8: ticks must not
// pile up a top-level run per tick while an earlier one is still working.
func TestTickSkippedWhileTopLevelActive(t *testing.T) {
	const name = "toplevel-busy-wf"
	p, entry, client := newTopLevelTickHarness(t, name)

	if err := client.Set(context.Background(), workflowTopLevelActiveKey(1, name),
		"held-by-earlier-run", time.Minute).Err(); err != nil {
		t.Fatalf("key setup failed: %v", err)
	}

	scheduler := NewWorkflowScheduler(p.ctx, p, entry)
	scheduler.allowlistChecked = true
	scheduler.tick()

	if got := p.workflowStatus.entry(name).LastTickOutcome; got != "skip_active" {
		t.Fatalf("tick must skip while a top-level run is active, outcome %q", got)
	}
	runs, err := p.runStore.ListRuns(syntheticWorkflowUserID(name, 1), 1, 50)
	if err != nil {
		t.Fatalf("listing runs failed: %v", err)
	}
	if len(runs) != 0 {
		t.Fatalf("a skipped tick must start no run, got %d", len(runs))
	}
}

// TestTopLevelTTLExpiryAllowsNextTick proves the TTL is the safety net for
// process death: a holder that never releases cannot deadlock the workflow.
func TestTopLevelTTLExpiryAllowsNextTick(t *testing.T) {
	const name = "toplevel-ttl-wf"
	p, entry, client := newTopLevelTickHarness(t, name)

	if err := client.Set(context.Background(), workflowTopLevelActiveKey(1, name),
		"crashed-run", time.Second).Err(); err != nil {
		t.Fatalf("key setup failed: %v", err)
	}
	waitForCondition(t, 5*time.Second, "top-level key expiry", func() bool {
		n, err := client.Exists(context.Background(), workflowTopLevelActiveKey(1, name)).Result()
		return err == nil && n == 0
	})

	scheduler := NewWorkflowScheduler(p.ctx, p, entry)
	scheduler.allowlistChecked = true
	scheduler.tick()

	if got := p.workflowStatus.entry(name).LastTickOutcome; got != "executed" {
		t.Fatalf("tick after key expiry must run, outcome %q", got)
	}
	waitForCondition(t, 10*time.Second, "run record", func() bool {
		runs, err := p.runStore.ListRuns(syntheticWorkflowUserID(name, 1), 1, 50)
		return err == nil && len(runs) == 1
	})
}

func TestWorkflowTickSkipsWhenIdentityUnseeded(t *testing.T) {
	client := workflowRedisTestClient(t)
	defer client.Close()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if err := client.Del(ctx, workflowTickLockKey(1, "idskip-wf")).Err(); err != nil {
		t.Fatalf("cleanup failed: %v", err)
	}

	p := &Plugin{
		logger:      log.DefaultLogger,
		redisClient: client,
		orgIdentity: NewOrgIdentityStore(),
		ctx:         ctx,
	}
	entry := validWorkflowEntry()
	entry.Name = "idskip-wf"
	entry.OrgID = 1
	entry.IntervalSec = 120

	// The tick verifies its entry against the org store, so seed it there; the
	// identity check must then be the first skip.
	if err := NewWorkflowStore(client, ctx, log.DefaultLogger).SaveWorkflows(ctx, 1, []WorkflowEntry{entry}); err != nil {
		t.Fatalf("store seed failed: %v", err)
	}
	t.Cleanup(func() { client.Del(context.Background(), workflowStoreKey(1)) })

	scheduler := NewWorkflowScheduler(ctx, p, entry)
	// The allowlist check is deferred to ticks with a live tool listing; an
	// empty proxy lists nothing, so simulate the check having passed.
	scheduler.allowlistChecked = true
	scheduler.tick()

	if got := testutil.ToFloat64(workflowTicks.WithLabelValues(workflowLabel(1, "idskip-wf"), "skip_identity")); got < 1 {
		t.Fatalf("skip_identity must be counted, got %v", got)
	}
	// Identity is checked before the lock: an unseeded replica must not take
	// the tick lock, or the seeded replica would find it held and skip.
	lockCtx, lockCancel := redisContext(ctx, RedisOpTimeout)
	defer lockCancel()
	held, err := acquireWorkflowTickLock(lockCtx, client, 1, "idskip-wf", time.Minute)
	if err != nil || !held {
		t.Fatalf("unseeded tick must leave the lock free: held=%v err=%v", held, err)
	}
}

// TestWorkflowTickColdStartIsPerOrg is the per-org cold start: an org with no
// identity record skips as skip_identity for itself, while a seeded org's
// workflow ticks and runs on the same instance and the same Redis.
func TestWorkflowTickColdStartIsPerOrg(t *testing.T) {
	client := workflowRedisTestClient(t)
	defer client.Close()
	ctx := context.Background()
	t.Cleanup(func() { client.FlushDB(context.Background()) })

	p, grafanaURL := newWorkflowTestPlugin(t, stubLLMFinalAnswer("tick ok"))
	p.redisClient = client
	p.usingRedis = true
	p.workflowTopLevel = make(map[string]int)
	p.orgIdentity.attachRedis(client, ctx, log.DefaultLogger)
	p.seedOrgIdentity(1, grafanaURL, "sa-token")

	hot := validWorkflowEntry()
	hot.Name = "hot-org-wf"
	hot.Skill = "dispatch"
	hot.IntervalSec = 120
	hot.SessionTimeoutSeconds = 60
	hot.OrgID = 1

	cold := validWorkflowEntry()
	cold.Name = "cold-org-wf"
	cold.Skill = "dispatch"
	cold.IntervalSec = 120
	cold.SessionTimeoutSeconds = 60
	cold.OrgID = 2

	// Each entry lives in its own org's store; the tick verifies it there.
	if err := NewWorkflowStore(client, ctx, log.DefaultLogger).SaveWorkflows(ctx, 1, []WorkflowEntry{hot}); err != nil {
		t.Fatalf("org 1 store seed failed: %v", err)
	}
	if err := NewWorkflowStore(client, ctx, log.DefaultLogger).SaveWorkflows(ctx, 2, []WorkflowEntry{cold}); err != nil {
		t.Fatalf("org 2 store seed failed: %v", err)
	}

	tickEntry := func(entry WorkflowEntry) {
		scheduler := NewWorkflowScheduler(p.ctx, p, entry)
		scheduler.allowlistChecked = true
		scheduler.tick()
	}

	// Org 2 has no identity record: its tick skips, for org 2 only.
	tickEntry(cold)
	if got := p.workflowStatus.entry(cold.Name).LastTickOutcome; got != "skip_identity" {
		t.Fatalf("unseeded org's tick must skip with skip_identity, got %q", got)
	}
	if got := testutil.ToFloat64(workflowTicks.WithLabelValues(workflowLabel(2, cold.Name), "skip_identity")); got < 1 {
		t.Fatalf("org 2's skip_identity must be counted, got %v", got)
	}
	// The cold org took no lock: org 1 remains free to tick.
	if n, err := client.Exists(ctx, workflowTickLockKey(2, cold.Name)).Result(); err != nil || n != 0 {
		t.Fatalf("cold org must leave its tick lock free: n=%d err=%v", n, err)
	}

	// Org 1's tick on the same instance and Redis proceeds normally.
	tickEntry(hot)
	if got := p.workflowStatus.entry(hot.Name).LastTickOutcome; got != "executed" {
		t.Fatalf("seeded org's tick must run, got %q", got)
	}
	runs, err := p.runStore.ListRuns(syntheticWorkflowUserID(hot.Name, 1), 1, 50)
	if err != nil || len(runs) != 1 {
		t.Fatalf("seeded org must start exactly one run: runs=%d err=%v", len(runs), err)
	}
	coldRuns, err := p.runStore.ListRuns(syntheticWorkflowUserID(cold.Name, 2), 2, 50)
	if err != nil || len(coldRuns) != 0 {
		t.Fatalf("the cold org must start no run: runs=%d err=%v", len(coldRuns), err)
	}
}
