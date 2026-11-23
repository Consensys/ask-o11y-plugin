package plugin

import (
	"context"
	"fmt"
	"net/http"
	"strings"
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
	return newStoreReconcileHarnessWithLogger(t, llmHandler, log.DefaultLogger)
}

// newStoreReconcileHarnessWithLogger is newStoreReconcileHarness with the
// plugin logger chosen up front. A test must not swap p.logger later: the
// first reconcile starts a scheduler goroutine that reads it, so a post-start
// assignment is a data race.
func newStoreReconcileHarnessWithLogger(t *testing.T, llmHandler http.HandlerFunc, lg log.Logger) (*Plugin, *redis.Client) {
	t.Helper()
	client := workflowRedisTestClient(t)
	t.Cleanup(func() { client.Close() })
	clearWorkflowStores(t, client, 1, 2)
	t.Cleanup(func() { clearWorkflowStores(t, client, 1, 2) })
	clearAppliedWorkflowNames(t, client, 1)
	clearAppliedWorkflowNames(t, client, 2)
	t.Cleanup(func() {
		clearAppliedWorkflowNames(t, client, 1)
		clearAppliedWorkflowNames(t, client, 2)
	})

	p, grafanaURL := newWorkflowTestPlugin(t, llmHandler)
	p.logger = lg
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
	saveReconcileEntriesForOrg(t, client, 1, entries...)
}

// saveReconcileEntriesForOrg replaces one org's stored list in the harness
// Redis.
func saveReconcileEntriesForOrg(t *testing.T, client *redis.Client, orgID int64, entries ...WorkflowEntry) {
	t.Helper()
	if err := NewWorkflowStore(client, context.Background(), log.DefaultLogger).SaveWorkflows(
		context.Background(), orgID, entries); err != nil {
		t.Fatalf("store save failed: %v", err)
	}
}

// clearAppliedWorkflowNames removes one org's persisted applied-set, so a
// fixture from an earlier test cannot decide a revocation assertion.
func clearAppliedWorkflowNames(t *testing.T, client *redis.Client, orgID int64) {
	t.Helper()
	if err := client.Del(context.Background(), appliedWorkflowNamesKey(orgID)).Err(); err != nil {
		t.Fatalf("clear applied workflow names failed: %v", err)
	}
}

// A reconcile adds the scheduler of a newly stored entry; removing the entry
// stops it, and the manager no longer holds it.
func TestReconcileAddsAndRemovesSchedulers(t *testing.T) {
	const name = "recon-add-remove-wf"
	p, client := newStoreReconcileHarness(t, stubLLMFinalAnswer("tick ok"))
	entry := storedReconcileEntry(name)

	saveReconcileEntries(t, client, entry)
	if _, _, ok := p.reconcileWorkflows(context.Background()); !ok {
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
	if got := p.workflowStatus.entry(1, name).LastTickOutcome; got != "executed" {
		t.Fatalf("the added scheduler's tick must execute, got %q", got)
	}
	waitForCondition(t, 5*time.Second, "run record from the added scheduler", func() bool {
		runs, err := p.runStore.ListRuns(syntheticWorkflowUserID(name, 1), 1, 50)
		return err == nil && len(runs) == 1
	})

	// Removing the entry stops the scheduler and drops it from the manager.
	saveReconcileEntries(t, client)
	if _, _, ok := p.reconcileWorkflows(context.Background()); !ok {
		t.Fatal("a readable store must report ok")
	}
	if !scheduler.Stopped() {
		t.Fatal("a removed entry's scheduler must be stopped")
	}
	if p.workflows.schedulerFor(1, name) != nil {
		t.Fatal("a removed entry must leave no scheduler behind")
	}
	// A second reconcile is a no-op, not a revival.
	if _, _, ok := p.reconcileWorkflows(context.Background()); !ok || p.workflows.schedulerFor(1, name) != nil {
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
	if _, _, ok := p.reconcileWorkflows(context.Background()); !ok {
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
	if _, _, ok := p.reconcileWorkflows(context.Background()); !ok {
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
	if _, _, ok := p.reconcileWorkflows(context.Background()); !ok {
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
	if _, _, ok := p.reconcileWorkflows(context.Background()); !ok {
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
	if _, _, ok := p.reconcileWorkflows(context.Background()); !ok {
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

	if got := p.workflowStatus.entry(1, name).LastTickOutcome; got != "skip_stale" {
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

// TestReconcileFailedOrgReadDoesNotRevokeShares is the fail-closed contract at
// the revocation seam: an org whose stored list cannot be read is not an org
// with no workflows. The NewPlugin sequence (reconcile, then revoke the removed
// entries) must leave that org's shares and applied set untouched.
func TestReconcileFailedOrgReadDoesNotRevokeShares(t *testing.T) {
	const name = "recon-unreadable-org-wf"
	const orgID = int64(2)
	p, client := newStoreReconcileHarness(t, stubLLMFinalAnswer("tick ok"))
	ctx := context.Background()

	entry := storedReconcileEntry(name)
	entry.OrgID = orgID
	saveReconcileEntriesForOrg(t, client, orgID, entry)

	// A previous load recorded org 2's entry, and its synthetic owner holds a
	// share that only a real removal may revoke.
	if err := client.SAdd(ctx, appliedWorkflowNamesKey(orgID), name).Err(); err != nil {
		t.Fatalf("applied-set fixture failed: %v", err)
	}
	hours := 24
	payload := []byte(`{"id":"s","messages":[{"role":"user","content":"x"}]}`)
	share, err := p.shareStore.CreateShare("s-unreadable-org", payload, orgID,
		syntheticWorkflowUserID(name, orgID), &hours)
	if err != nil {
		t.Fatalf("share creation failed: %v", err)
	}

	// SCAN still lists org 2, but its record no longer decodes.
	if err := client.Set(ctx, workflowStoreKey(orgID), "{not-json", 0).Err(); err != nil {
		t.Fatalf("corrupt fixture failed: %v", err)
	}

	discovered, unreadable, ok := p.reconcileWorkflows(ctx)
	if !ok {
		t.Fatal("one unreadable org must not fail the whole reconcile")
	}
	if !unreadable[orgID] {
		t.Fatalf("org %d's failed read must be reported unreadable", orgID)
	}
	p.revokeRemovedWorkflowShares(discovered, unreadable)

	if _, err := p.shareStore.GetShare(share.ShareID); err != nil {
		t.Fatalf("a failed read for org %d must not revoke its shares: %v", orgID, err)
	}
	applied, err := client.SMembers(ctx, appliedWorkflowNamesKey(orgID)).Result()
	if err != nil {
		t.Fatalf("read applied set failed: %v", err)
	}
	if len(applied) != 1 || applied[0] != name {
		t.Fatalf("a failed read must not rewrite org %d's applied set, got %v", orgID, applied)
	}
}

// TestReconcileFailedOrgReadKeepsSchedulersRunning covers the other half of the
// same shape: an unreadable org is absent from the desired set, and that
// absence must not stop its healthy schedulers.
func TestReconcileFailedOrgReadKeepsSchedulersRunning(t *testing.T) {
	const name = "recon-unreadable-keeps-scheduler-wf"
	const orgID = int64(2)
	p, client := newStoreReconcileHarness(t, stubLLMFinalAnswer("tick ok"))
	ctx := context.Background()

	entry := storedReconcileEntry(name)
	entry.OrgID = orgID
	saveReconcileEntriesForOrg(t, client, orgID, entry)

	if _, _, ok := p.reconcileWorkflows(ctx); !ok {
		t.Fatal("a readable store must report ok")
	}
	scheduler := p.workflows.schedulerFor(orgID, name)
	if scheduler == nil || !p.workflows.isRunning(orgID, name) {
		t.Fatal("a stored entry must start a running scheduler")
	}

	// The record turns unreadable while its scheduler keeps running.
	if err := client.Set(ctx, workflowStoreKey(orgID), "{not-json", 0).Err(); err != nil {
		t.Fatalf("corrupt fixture failed: %v", err)
	}
	_, unreadable, ok := p.reconcileWorkflows(ctx)
	if !ok {
		t.Fatal("one unreadable org must not fail the whole reconcile")
	}
	if !unreadable[orgID] {
		t.Fatalf("org %d's failed read must be reported unreadable", orgID)
	}
	if scheduler.Stopped() {
		t.Fatal("a failed read must not stop that org's scheduler")
	}
	if got := p.workflows.schedulerFor(orgID, name); got != scheduler {
		t.Fatal("a failed read must leave the same scheduler in the manager")
	}
	if !p.workflows.isRunning(orgID, name) {
		t.Fatal("a failed read must leave the org's scheduler running")
	}
}

// firstStoreReadBarrier delays the first GET of one workflow store key until
// release, after that GET already executed. The reconcile that issues it
// therefore holds the pre-write snapshot: exactly the stale read that a hot
// apply must supersede.
type firstStoreReadBarrier struct {
	key     string
	reached chan struct{}
	release chan struct{}
	once    sync.Once
}

func (h *firstStoreReadBarrier) DialHook(next redis.DialHook) redis.DialHook { return next }

func (h *firstStoreReadBarrier) ProcessHook(next redis.ProcessHook) redis.ProcessHook {
	return func(ctx context.Context, cmd redis.Cmder) error {
		err := next(ctx, cmd)
		args := cmd.Args()
		if cmd.Name() == "get" && len(args) > 1 && args[1] == h.key {
			first := false
			h.once.Do(func() { first = true })
			if first {
				close(h.reached)
				<-h.release
			}
		}
		return err
	}
}

func (h *firstStoreReadBarrier) ProcessPipelineHook(next redis.ProcessPipelineHook) redis.ProcessPipelineHook {
	return next
}

// errorCapturingLogger records Error-level lines so a test can prove a
// deliberate off switch logs no configuration defect.
type errorCapturingLogger struct {
	mu    sync.Mutex
	lines []string
}

func (l *errorCapturingLogger) Debug(string, ...any) {}
func (l *errorCapturingLogger) Info(string, ...any)  {}
func (l *errorCapturingLogger) Warn(string, ...any)  {}

func (l *errorCapturingLogger) Error(msg string, args ...any) {
	l.mu.Lock()
	l.lines = append(l.lines, msg+fmt.Sprint(args...))
	l.mu.Unlock()
}

func (l *errorCapturingLogger) With(...any) log.Logger                 { return l }
func (l *errorCapturingLogger) Level() log.Level                       { return log.Error }
func (l *errorCapturingLogger) FromContext(context.Context) log.Logger { return l }

func (l *errorCapturingLogger) errorLines() []string {
	l.mu.Lock()
	defer l.mu.Unlock()
	return append([]string(nil), l.lines...)
}

// TestReconcileAbortsWhenNewerReconcileStarted covers the stale-reconcile race:
// a loop pass reads the old list, a save hot-applies a changed entry, then the
// stale pass resumes. Its apply must be dropped, so the scheduler the hot apply
// created still carries the changed entry instead of being restarted with the
// old one.
func TestReconcileAbortsWhenNewerReconcileStarted(t *testing.T) {
	p, client := newStoreReconcileHarness(t, stubLLMFinalAnswer("tick ok"))
	ctx := context.Background()
	const name = "recon-race-wf"

	stale := storedReconcileEntry(name)
	stale.IntervalSec = 120
	saveReconcileEntries(t, client, stale)

	barrier := &firstStoreReadBarrier{
		key:     workflowStoreKey(1),
		reached: make(chan struct{}),
		release: make(chan struct{}),
	}
	client.AddHook(barrier)

	// The loop-shaped pass: it claims a generation, reads the old list, and
	// then waits inside the hook with that snapshot in hand.
	loopDone := make(chan struct{})
	go func() {
		defer close(loopDone)
		p.reconcileWorkflows(ctx)
	}()
	<-barrier.reached

	// The save hot-applys a changed entry through the real PUT route while the
	// loop pass is still blocked.
	body := fmt.Sprintf(`{"workflows":[{"name":%q,"enabled":true,"skill":"dispatch",`+
		`"intervalSeconds":600,"sessionTimeoutSeconds":120,`+
		`"toolAllowlist":["mcp-grafana_list_alert_groups"],"maxConcurrentSessions":3}]}`, name)
	if rec := putWorkflowsRequest(t, p, 1, "Admin", body); rec.Code != http.StatusOK {
		t.Fatalf("the hot apply save must succeed, got %d: %s", rec.Code, rec.Body.String())
	}
	applied := p.workflows.schedulerFor(1, name)
	if applied == nil {
		t.Fatal("the hot apply must start the changed entry's scheduler")
	}

	close(barrier.release)
	<-loopDone

	if got := p.workflows.schedulerFor(1, name); got != applied {
		t.Fatal("a stale reconcile must not restart the scheduler the hot apply created")
	}
	if applied.Stopped() {
		t.Fatal("a stale reconcile must not stop the hot-applied scheduler")
	}
	p.workflows.mu.Lock()
	tracked, ok := p.workflows.entries[workflowKey{orgID: 1, name: name}]
	p.workflows.mu.Unlock()
	if !ok || tracked.IntervalSec != 600 {
		t.Fatalf("a stale reconcile must not restore the old entry, got %+v (tracked=%v)", tracked, ok)
	}
}

// TestReconcileStoppedDisabledEntryEmitsNoErrorLog: the admin off switch is not
// a defect. Disabling a running entry stops its scheduler, drops it from the
// applied set, and logs no "invalid configuration" error.
func TestReconcileStoppedDisabledEntryEmitsNoErrorLog(t *testing.T) {
	capture := &errorCapturingLogger{}
	p, client := newStoreReconcileHarnessWithLogger(t, stubLLMFinalAnswer("tick ok"), capture)
	ctx := context.Background()
	const name = "recon-toggle-off-wf"

	entry := storedReconcileEntry(name)
	saveReconcileEntries(t, client, entry)
	if _, _, ok := p.reconcileWorkflows(ctx); !ok {
		t.Fatal("a readable store must report ok")
	}
	if p.workflows.schedulerFor(1, name) == nil {
		t.Fatal("an enabled entry must start a scheduler")
	}

	disabled := entry
	disabled.Enabled = false
	saveReconcileEntries(t, client, disabled)
	if _, _, ok := p.reconcileWorkflows(ctx); !ok {
		t.Fatal("a readable store must report ok")
	}
	if s := p.workflows.schedulerFor(1, name); s != nil {
		t.Fatal("disabling an entry must stop its scheduler")
	}
	p.workflows.mu.Lock()
	_, tracked := p.workflows.entries[workflowKey{orgID: 1, name: name}]
	p.workflows.mu.Unlock()
	if tracked {
		t.Fatal("a disabled entry must leave the applied set")
	}
	for _, line := range capture.errorLines() {
		if strings.Contains(line, "invalid configuration") {
			t.Fatalf("a deliberate off switch must not log a configuration error: %s", line)
		}
	}
}
