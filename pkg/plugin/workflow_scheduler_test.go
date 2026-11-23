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
	if err := client.Del(ctx, workflowTickLockKey("lock-wf")).Err(); err != nil {
		t.Fatalf("cleanup failed: %v", err)
	}

	held, err := acquireWorkflowTickLock(ctx, client, "lock-wf", time.Minute)
	if err != nil || !held {
		t.Fatalf("first acquisition must win: held=%v err=%v", held, err)
	}
	held, err = acquireWorkflowTickLock(ctx, client, "lock-wf", time.Minute)
	if err != nil || held {
		t.Fatalf("second acquisition must lose while held: held=%v err=%v", held, err)
	}
}

func TestAcquireWorkflowTickLockExpiresWithTTL(t *testing.T) {
	client := workflowRedisTestClient(t)
	defer client.Close()

	ctx := context.Background()
	if err := client.Del(ctx, workflowTickLockKey("ttl-wf")).Err(); err != nil {
		t.Fatalf("cleanup failed: %v", err)
	}

	held, _ := acquireWorkflowTickLock(ctx, client, "ttl-wf", 200*time.Millisecond)
	if !held {
		t.Fatal("first acquisition must win")
	}
	time.Sleep(350 * time.Millisecond)
	held, err := acquireWorkflowTickLock(ctx, client, "ttl-wf", 200*time.Millisecond)
	if err != nil || !held {
		t.Fatalf("lock must free after its TTL: held=%v err=%v", held, err)
	}
}

func TestWorkflowActiveSpawnSetLifecycle(t *testing.T) {
	client := workflowRedisTestClient(t)
	defer client.Close()

	p := &Plugin{logger: log.DefaultLogger, redisClient: client, ctx: context.Background()}
	name := "spawnset-wf"
	if err := client.Del(p.ctx, workflowActiveSpawnKey(name)).Err(); err != nil {
		t.Fatalf("cleanup failed: %v", err)
	}

	deadline := time.Now().Add(time.Minute)
	if err := p.workflowActiveSpawnAdd(name, "run-1", deadline); err != nil {
		t.Fatalf("add failed: %v", err)
	}
	// An expired member: its deadline already passed, so it must be pruned.
	if err := p.workflowActiveSpawnAdd(name, "run-stale", time.Now().Add(-time.Minute)); err != nil {
		t.Fatalf("add failed: %v", err)
	}

	count, err := p.workflowActiveSpawnCount(name)
	if err != nil {
		t.Fatalf("count failed: %v", err)
	}
	if count != 1 {
		t.Fatalf("expired members must be pruned; active=%d", count)
	}

	p.workflowActiveSpawnRemove(name, "run-1")
	count, err = p.workflowActiveSpawnCount(name)
	if err != nil || count != 0 {
		t.Fatalf("removed member must be gone: count=%d err=%v", count, err)
	}
}

func TestStartWorkflowsWithoutRedisDisablesAllEntries(t *testing.T) {
	// Point at a port where nothing listens, so the plugin falls back to
	// in-memory storage and workflows must refuse to start (FR-005).
	settings := backend.AppInstanceSettings{
		JSONData: []byte(`{
			"mcpServers": [],
			"skills": {"entries": {"wf-skill": {"content": "---\nname: wf-skill\ndescription: test.\n---\nBody"}}},
			"workflows": [{"name": "no-redis-wf", "enabled": true, "orgId": 1, "skill": "wf-skill", "toolAllowlist": ["t_a"]}]
		}`),
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
	if p.workflows != nil {
		t.Fatal("workflows must not start without Redis")
	}
	if len(p.settings.Workflows) != 1 {
		t.Fatalf("settings must parse the workflow entry: %d", len(p.settings.Workflows))
	}
}

func TestStartWorkflowsStartsOnlyValidEntries(t *testing.T) {
	probe := workflowRedisTestClient(t)
	url := "redis://localhost:6379/15"
	probe.Close() // probe only; NewPlugin opens its own client

	settings := backend.AppInstanceSettings{
		JSONData: []byte(`{
			"mcpServers": [],
			"skills": {"entries": {"wf-good": {"content": "---\nname: wf-good\ndescription: test.\n---\nBody"}}},
			"workflows": [
				{"name": "good-wf", "enabled": true, "orgId": 1, "skill": "wf-good", "toolAllowlist": ["t_a"]},
				{"name": "bad-wf", "enabled": true, "orgId": 1, "skill": "missing", "toolAllowlist": ["t_a"]}
			]
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
		t.Fatal("valid workflow entries must start when Redis is configured")
	}
	if len(p.workflows.schedulers) != 1 {
		t.Fatalf("exactly the valid entry must run, got %d", len(p.workflows.schedulers))
	}
	if p.workflows.schedulers[0].entry.Name != "good-wf" {
		t.Fatalf("wrong entry started: %q", p.workflows.schedulers[0].entry.Name)
	}
}

// TestWorkflowTickSurvivesSettingsSave is the refutation for designer-F1: a
// settings save builds a fresh plugin instance, and its first tick must run
// because NewPlugin restored the persisted org binding. Before the fix the
// fresh instance skipped with skip_identity until a human chatted in the org.
func TestWorkflowTickSurvivesSettingsSave(t *testing.T) {
	client := workflowRedisTestClient(t)
	defer client.Close()
	ctx := context.Background()

	entry := validWorkflowEntry()
	entry.Name = "save-survive-wf"
	entry.Skill = "dispatch"
	entry.IntervalSec = 120

	if err := client.Del(ctx, orgIdentityRedisKey, workflowTickLockKey(entry.Name)).Err(); err != nil {
		t.Fatalf("cleanup failed: %v", err)
	}
	t.Cleanup(func() {
		client.Del(context.Background(), orgIdentityRedisKey, workflowTickLockKey(entry.Name))
		// The run store is Redis db 15 indexed under a stable synthetic user
		// ID, so without this flush a second suite run sees this test's stale
		// run records and fails its exact-count assertions.
		client.FlushDB(context.Background())
	})

	tick := func(p *Plugin) {
		scheduler := NewWorkflowScheduler(p.ctx, p, entry)
		// The allowlist check is deferred to ticks with a live tool listing;
		// an empty proxy lists nothing, so simulate the check having passed.
		scheduler.allowlistChecked = true
		scheduler.tick()
	}

	// First instance: a human request seeds and persists the identity.
	before, grafanaURL := newWorkflowTestPlugin(t, stubLLMFinalAnswer("tick ok"))
	before.redisClient = client
	before.usingRedis = true
	before.seedOrgIdentity(1, grafanaURL, "sa-token")
	tick(before)

	syntheticID := syntheticWorkflowUserID(entry.Name)
	runsBefore, err := before.runStore.ListRuns(syntheticID, 1, 50)
	if err != nil || len(runsBefore) != 1 {
		t.Fatalf("seeded tick must start exactly one run: runs=%d err=%v", len(runsBefore), err)
	}

	// Settings save: NewPlugin builds a fresh instance against the same Redis,
	// and it must restore the binding before its workflows start. The previous
	// tick's lock is still held (TTL is half the interval), so clear it as a
	// later interval would.
	if err := client.Del(ctx, workflowTickLockKey(entry.Name)).Err(); err != nil {
		t.Fatalf("lock cleanup failed: %v", err)
	}
	instance, err := NewPlugin(ctx, backend.AppInstanceSettings{
		JSONData: []byte(`{
			"mcpServers": [],
			"skills": {"entries": {"dispatch": {"content": "---\nname: dispatch\ndescription: test.\n---\nBody"}}},
			"workflows": [{"name": "save-survive-wf", "enabled": true, "skill": "dispatch", "intervalSeconds": 120, "toolAllowlist": ["t_a"], "sessionTimeoutSeconds": 60}]
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
	if orgID, url, token, ok := after.orgIdentity.Get(); !ok || orgID != 1 || url != grafanaURL || token != "sa-token" {
		t.Fatalf("settings save must restore the persisted identity: %d %q %q %v", orgID, url, token, ok)
	}
	if after.workflows == nil || len(after.workflows.schedulers) != 1 {
		t.Fatalf("the workflow entry must start after a settings save")
	}
	// The allowlist check is deferred to ticks with a live tool listing; an
	// empty proxy lists nothing, so simulate the check having passed.
	after.workflows.schedulers[0].allowlistChecked = true
	after.workflows.schedulers[0].tick()

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
		client.Del(context.Background(), workflowTopLevelActiveKey(name), workflowTickLockKey(name), orgIdentityRedisKey)
	}
	cleanup()
	t.Cleanup(cleanup)

	entry := validWorkflowEntry()
	entry.Name = name
	entry.Skill = "dispatch"
	entry.IntervalSec = 120
	entry.SessionTimeoutSeconds = 60

	p, grafanaURL := newWorkflowTestPlugin(t, stubLLMFinalAnswer("tick ok"))
	p.redisClient = client
	p.usingRedis = true
	p.workflowTopLevel = make(map[string]int)
	p.seedOrgIdentity(1, grafanaURL, "sa-token")
	return p, entry, client
}

// TestTickSkippedWhileTopLevelActive is the refutation for S8: ticks must not
// pile up a top-level run per tick while an earlier one is still working.
func TestTickSkippedWhileTopLevelActive(t *testing.T) {
	const name = "toplevel-busy-wf"
	p, entry, client := newTopLevelTickHarness(t, name)

	if err := client.Set(context.Background(), workflowTopLevelActiveKey(name),
		"held-by-earlier-run", time.Minute).Err(); err != nil {
		t.Fatalf("key setup failed: %v", err)
	}

	scheduler := NewWorkflowScheduler(p.ctx, p, entry)
	scheduler.allowlistChecked = true
	scheduler.tick()

	if got := p.workflowStatus.entry(name).LastTickOutcome; got != "skip_active" {
		t.Fatalf("tick must skip while a top-level run is active, outcome %q", got)
	}
	runs, err := p.runStore.ListRuns(syntheticWorkflowUserID(name), 1, 50)
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

	if err := client.Set(context.Background(), workflowTopLevelActiveKey(name),
		"crashed-run", time.Second).Err(); err != nil {
		t.Fatalf("key setup failed: %v", err)
	}
	waitForCondition(t, 5*time.Second, "top-level key expiry", func() bool {
		n, err := client.Exists(context.Background(), workflowTopLevelActiveKey(name)).Result()
		return err == nil && n == 0
	})

	scheduler := NewWorkflowScheduler(p.ctx, p, entry)
	scheduler.allowlistChecked = true
	scheduler.tick()

	if got := p.workflowStatus.entry(name).LastTickOutcome; got != "executed" {
		t.Fatalf("tick after key expiry must run, outcome %q", got)
	}
	waitForCondition(t, 10*time.Second, "run record", func() bool {
		runs, err := p.runStore.ListRuns(syntheticWorkflowUserID(name), 1, 50)
		return err == nil && len(runs) == 1
	})
}

func TestWorkflowTickSkipsWhenIdentityUnseeded(t *testing.T) {
	client := workflowRedisTestClient(t)
	defer client.Close()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if err := client.Del(ctx, workflowTickLockKey("idskip-wf")).Err(); err != nil {
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
	entry.IntervalSec = 120

	scheduler := NewWorkflowScheduler(ctx, p, entry)
	// The allowlist check is deferred to ticks with a live tool listing; an
	// empty proxy lists nothing, so simulate the check having passed.
	scheduler.allowlistChecked = true
	scheduler.tick()

	if got := testutil.ToFloat64(workflowTicks.WithLabelValues("idskip-wf", "skip_identity")); got < 1 {
		t.Fatalf("skip_identity must be counted, got %v", got)
	}
	// Identity is checked before the lock: an unseeded replica must not take
	// the tick lock, or the seeded replica would find it held and skip.
	lockCtx, lockCancel := redisContext(ctx, RedisOpTimeout)
	defer lockCancel()
	held, err := acquireWorkflowTickLock(lockCtx, client, "idskip-wf", time.Minute)
	if err != nil || !held {
		t.Fatalf("unseeded tick must leave the lock free: held=%v err=%v", held, err)
	}
}
