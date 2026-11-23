package plugin

import (
	"context"
	"net/http"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	"github.com/redis/go-redis/v9"
)

// newStoreReconcileHarness builds a store-backed plugin with an empty manager
// and a seeded org identity, so a reconcile-started scheduler can execute a
// tick without touching the network beyond the stub LLM.
func newStoreReconcileHarness(t *testing.T, llmHandler http.HandlerFunc) (*Plugin, *redis.Client) {
	t.Helper()
	client := workflowRedisTestClient(t)
	t.Cleanup(func() { client.Close() })
	clearWorkflowStores(t, client, 1)
	t.Cleanup(func() { clearWorkflowStores(t, client, 1) })

	p, grafanaURL := newWorkflowTestPlugin(t, llmHandler)
	p.redisClient = client
	p.usingRedis = true
	p.workflows = newWorkflowManager(p, p.ctx)
	p.orgIdentity.attachRedis(client, p.ctx, log.DefaultLogger)
	p.seedOrgIdentity(1, grafanaURL, "sa-token")
	t.Cleanup(p.workflows.Stop)
	return p, client
}

// storedReconcileEntry is a valid org 1 entry named for the calling test.
func storedReconcileEntry(name string) WorkflowEntry {
	entry := validWorkflowEntry()
	entry.Name = name
	entry.OrgID = 1
	entry.Skill = "dispatch"
	entry.IntervalSec = 120
	entry.SessionTimeoutSeconds = 60
	return entry
}

// saveReconcileEntries replaces org 1's stored list in the harness Redis.
func saveReconcileEntries(t *testing.T, client *redis.Client, entries ...WorkflowEntry) {
	t.Helper()
	if err := NewWorkflowStore(client, context.Background(), log.DefaultLogger).SaveWorkflows(
		context.Background(), 1, entries); err != nil {
		t.Fatalf("store save failed: %v", err)
	}
}

// A reconcile adds the scheduler of a newly stored entry; removing the entry
// stops it, and the manager no longer holds it.
func TestReconcileAddsAndRemovesSchedulers(t *testing.T) {
	const name = "recon-add-remove-wf"
	p, client := newStoreReconcileHarness(t, stubLLMFinalAnswer("tick ok"))
	entry := storedReconcileEntry(name)

	saveReconcileEntries(t, client, entry)
	if _, ok := p.reconcileWorkflows(context.Background()); !ok {
		t.Fatal("a readable store must report ok")
	}
	scheduler := p.workflows.schedulerFor(1, name)
	if scheduler == nil {
		t.Fatal("an added entry must start a scheduler")
	}
	if !p.workflows.isRunning(1, name) {
		t.Fatal("the started scheduler must report running")
	}

	// Prove the added scheduler is wired to the tick path.
	scheduler.allowlistChecked = true
	scheduler.tick()
	if got := p.workflowStatus.entry(name).LastTickOutcome; got != "executed" {
		t.Fatalf("the added scheduler's tick must execute, got %q", got)
	}
	waitForCondition(t, 5*time.Second, "run record from the added scheduler", func() bool {
		runs, err := p.runStore.ListRuns(syntheticWorkflowUserID(name, 1), 1, 50)
		return err == nil && len(runs) == 1
	})

	// Removing the entry stops the scheduler and drops it from the manager.
	saveReconcileEntries(t, client)
	if _, ok := p.reconcileWorkflows(context.Background()); !ok {
		t.Fatal("a readable store must report ok")
	}
	if !scheduler.Stopped() {
		t.Fatal("a removed entry's scheduler must be stopped")
	}
	if p.workflows.schedulerFor(1, name) != nil {
		t.Fatal("a removed entry must leave no scheduler behind")
	}
	// A second reconcile is a no-op, not a revival.
	if _, ok := p.reconcileWorkflows(context.Background()); !ok || p.workflows.schedulerFor(1, name) != nil {
		t.Fatal("a removed entry must stay removed across reconciles")
	}
}

// A changed field restarts the scheduler: the old one stops, a new one runs
// with the new interval.
func TestReconcileRestartsChangedEntry(t *testing.T) {
	const name = "recon-restart-wf"
	p, client := newStoreReconcileHarness(t, stubLLMFinalAnswer("tick ok"))
	entry := storedReconcileEntry(name)

	saveReconcileEntries(t, client, entry)
	if _, ok := p.reconcileWorkflows(context.Background()); !ok {
		t.Fatal("first reconcile must report ok")
	}
	first := p.workflows.schedulerFor(1, name)
	if first == nil {
		t.Fatal("the entry must start a scheduler")
	}

	// Only the interval changes; any field difference is a restart.
	changed := entry
	changed.IntervalSec = 300
	saveReconcileEntries(t, client, changed)
	if _, ok := p.reconcileWorkflows(context.Background()); !ok {
		t.Fatal("second reconcile must report ok")
	}
	second := p.workflows.schedulerFor(1, name)
	if second == nil {
		t.Fatal("a changed entry must still run")
	}
	if second == first {
		t.Fatal("a changed entry must restart, not keep the old scheduler")
	}
	if !first.Stopped() {
		t.Fatal("the superseded scheduler must be stopped")
	}
	if second.Stopped() {
		t.Fatal("the replacement scheduler must be live")
	}
	if got := second.entry.IntervalSec; got != 300 {
		t.Fatalf("the replacement must carry the new interval, got %d", got)
	}
}

// TestWorkflowRunSurvivesReconcile is the shutdown contract at the scheduler
// seam: reconcile stops the scheduler but never the run it already started.
func TestWorkflowRunSurvivesReconcile(t *testing.T) {
	const name = "recon-survive-run-wf"
	release := make(chan struct{})
	var once sync.Once
	openGate := func() { once.Do(func() { close(release) }) }
	t.Cleanup(openGate)

	handler := func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-release:
		case <-r.Context().Done():
			return
		}
		stubLLMFinalAnswer("the investigation finished")(w, r)
	}
	p, client := newStoreReconcileHarness(t, handler)
	entry := storedReconcileEntry(name)
	saveReconcileEntries(t, client, entry)
	if _, ok := p.reconcileWorkflows(context.Background()); !ok {
		t.Fatal("reconcile must report ok")
	}
	scheduler := p.workflows.schedulerFor(1, name)
	if scheduler == nil {
		t.Fatal("the entry must start a scheduler")
	}
	scheduler.allowlistChecked = true
	scheduler.tick()

	waitForCondition(t, 10*time.Second, "the in-flight run record", func() bool {
		runs, err := p.runStore.ListRuns(syntheticWorkflowUserID(name, 1), 1, 50)
		return err == nil && len(runs) == 1
	})
	if got := p.workflowRuns.inFlight(); got != 1 {
		t.Fatalf("the tick must hold one in-flight run, got %d", got)
	}

	// Remove the entry mid-run and reconcile: the scheduler stops, the run
	// does not.
	saveReconcileEntries(t, client)
	if _, ok := p.reconcileWorkflows(context.Background()); !ok {
		t.Fatal("removal reconcile must report ok")
	}
	if !scheduler.Stopped() {
		t.Fatal("the removed entry's scheduler must be stopped")
	}
	if got := p.workflowRuns.inFlight(); got != 1 {
		t.Fatalf("reconcile must leave the in-flight run untouched, got %d", got)
	}
	runs, err := p.runStore.ListRuns(syntheticWorkflowUserID(name, 1), 1, 50)
	if err != nil || len(runs) != 1 || runs[0].Status != RunStatusRunning {
		t.Fatalf("the run must still be running after its entry is removed: %+v err=%v", runs, err)
	}

	openGate()
	waitForCondition(t, 15*time.Second, "the run to complete", func() bool {
		runs, err := p.runStore.ListRuns(syntheticWorkflowUserID(name, 1), 1, 50)
		return err == nil && len(runs) == 1 && runs[0].Status == RunStatusCompleted
	})
	if got := p.workflowRuns.inFlight(); got != 0 {
		t.Fatalf("the completed run must leave the tracker, got %d", got)
	}
}

// TestWorkflowTickSkipsRemovedEntryBeforeReconcile is the token guard: a direct
// store removal makes the next tick skip, with no run record and no LLM call,
// even though the reconcile loop has not run yet.
func TestWorkflowTickSkipsRemovedEntryBeforeReconcile(t *testing.T) {
	const name = "tick-stale-wf"
	var requests atomic.Int64
	counting := func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		stubLLMFinalAnswer("tick ok")(w, r)
	}
	p, client := newStoreReconcileHarness(t, counting)
	entry := storedReconcileEntry(name)
	saveReconcileEntries(t, client, entry)
	if _, ok := p.reconcileWorkflows(context.Background()); !ok {
		t.Fatal("reconcile must report ok")
	}
	scheduler := p.workflows.schedulerFor(1, name)
	if scheduler == nil {
		t.Fatal("the entry must start a scheduler")
	}
	scheduler.allowlistChecked = true
	scheduler.tick()
	waitForCondition(t, 10*time.Second, "the first run to complete", func() bool {
		runs, err := p.runStore.ListRuns(syntheticWorkflowUserID(name, 1), 1, 50)
		return err == nil && len(runs) == 1 && runs[0].Status == RunStatusCompleted
	})
	firstRequests := requests.Load()
	synthetic := syntheticWorkflowUserID(name, 1)

	// Remove the entry from the store only: no reconcile, no manager change.
	saveReconcileEntries(t, client)
	scheduler.tick()

	if got := p.workflowStatus.entry(name).LastTickOutcome; got != "skip_stale" {
		t.Fatalf("a removed entry's tick must skip as skip_stale, got %q", got)
	}
	if scheduler.Stopped() {
		t.Fatal("the per-tick check must skip, not stop, the scheduler")
	}
	runs, err := p.runStore.ListRuns(synthetic, 1, 50)
	if err != nil || len(runs) != 1 {
		t.Fatalf("a stale tick must start no run: runs=%d err=%v", len(runs), err)
	}
	if got := requests.Load(); got != firstRequests {
		t.Fatalf("a stale tick must spend no token: requests %d -> %d", firstRequests, got)
	}
}
