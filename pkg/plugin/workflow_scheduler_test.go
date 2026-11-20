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
