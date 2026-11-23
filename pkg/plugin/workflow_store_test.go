package plugin

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/redis/go-redis/v9"
)

// newRedisBackedWorkflowPlugin builds a plugin whose workflow entry store uses
// the dev Redis test database. The org keys it owns are cleared before and
// after the test, so a stale fixture cannot decide the result.
func newRedisBackedWorkflowPlugin(t *testing.T) (*Plugin, *redis.Client) {
	t.Helper()
	p := newAgentRunTestPlugin(t)
	client := workflowRedisTestClient(t)
	t.Cleanup(func() { client.Close() })

	p.redisClient = client
	p.usingRedis = true
	p.ctx = context.Background()
	p.workflows = newWorkflowManager(p, p.ctx)
	// The hot-apply path revokes removed entries' shares, so the store must be
	// present; tests that inspect shares replace it with their own.
	p.shareStore = NewShareStore(p.logger, NewInMemoryRateLimiter(p.logger))
	t.Cleanup(p.workflows.Stop)

	clearWorkflowStores(t, client, 1, 2)
	t.Cleanup(func() { clearWorkflowStores(t, client, 1, 2) })
	return p, client
}

// clearWorkflowStores removes the entry lists of the given orgs.
func clearWorkflowStores(t *testing.T, client *redis.Client, orgIDs ...int64) {
	t.Helper()
	keys := make([]string, 0, len(orgIDs))
	for _, orgID := range orgIDs {
		keys = append(keys, workflowStoreKey(orgID))
	}
	if err := client.Del(context.Background(), keys...).Err(); err != nil {
		t.Fatalf("clear workflow stores failed: %v", err)
	}
}

// workflowStoreSnapshot returns the raw stored record, or "<absent>" when the
// org saved nothing. Comparing two snapshots proves a failed save wrote
// nothing.
func workflowStoreSnapshot(t *testing.T, client *redis.Client, orgID int64) string {
	t.Helper()
	raw, err := client.Get(context.Background(), workflowStoreKey(orgID)).Result()
	if errors.Is(err, redis.Nil) {
		return "<absent>"
	}
	if err != nil {
		t.Fatalf("read workflow store snapshot failed: %v", err)
	}
	return raw
}

// validWorkflowEntry returns an entry that passes validateWorkflowEntry. The
// skill is a shipped bundled skill, so the registry of a test plugin resolves
// it; the tool name is only checked against the catalog at tick time.
func validStoredWorkflowEntry(name string) WorkflowEntry {
	return WorkflowEntry{
		Name:                  name,
		Enabled:               true,
		Skill:                 "investigating-alerts",
		IntervalSec:           workflowDefaultIntervalSeconds,
		SessionTimeoutSeconds: workflowDefaultTimeoutSeconds,
		MaxConcurrentSessions: workflowDefaultMaxConcurrent,
		ToolAllowlist:         []string{"irm_list_alert_groups"},
	}
}

func TestWorkflowStoreRoundTripsPerOrg(t *testing.T) {
	client := workflowRedisTestClient(t)
	t.Cleanup(func() { client.Close() })
	clearWorkflowStores(t, client, 1, 2, 3)
	t.Cleanup(func() { clearWorkflowStores(t, client, 1, 2, 3) })

	store := NewWorkflowStore(client, context.Background(), nil)
	ctx := context.Background()

	// A missing record is an empty list, not an error: the org saved nothing.
	if entries, err := store.ListWorkflows(ctx, 3); err != nil || len(entries) != 0 {
		t.Fatalf("missing record must read as an empty list: %v %+v", err, entries)
	}

	if err := store.SaveWorkflows(ctx, 1, []WorkflowEntry{validStoredWorkflowEntry("org-one")}); err != nil {
		t.Fatalf("org 1 save failed: %v", err)
	}
	if err := store.SaveWorkflows(ctx, 2, []WorkflowEntry{validStoredWorkflowEntry("org-two")}); err != nil {
		t.Fatalf("org 2 save failed: %v", err)
	}

	one, err := store.ListWorkflows(ctx, 1)
	if err != nil || len(one) != 1 || one[0].Name != "org-one" {
		t.Fatalf("org 1 must read its own entry: %v %+v", err, one)
	}
	if one[0].OrgID != 1 {
		t.Fatalf("stored entry must carry its owning org, got %d", one[0].OrgID)
	}
	two, err := store.ListWorkflows(ctx, 2)
	if err != nil || len(two) != 1 || two[0].Name != "org-two" {
		t.Fatalf("org 2 must read its own entry: %v %+v", err, two)
	}

	// A save replaces the whole list; it never appends.
	if err := store.SaveWorkflows(ctx, 1, []WorkflowEntry{validStoredWorkflowEntry("org-one-b")}); err != nil {
		t.Fatalf("org 1 replace failed: %v", err)
	}
	one, err = store.ListWorkflows(ctx, 1)
	if err != nil || len(one) != 1 || one[0].Name != "org-one-b" {
		t.Fatalf("save must replace the whole list: %v %+v", err, one)
	}
}

func TestWorkflowStoreFailsClosedWithoutRedis(t *testing.T) {
	store := NewWorkflowStore(nil, context.Background(), nil)
	if entries, err := store.ListWorkflows(context.Background(), 1); err == nil {
		t.Fatalf("a store without Redis must error, never synthesize an empty list: %+v", entries)
	}
	if err := store.SaveWorkflows(context.Background(), 1, []WorkflowEntry{validStoredWorkflowEntry("wf")}); err == nil {
		t.Fatal("a store without Redis must refuse a save")
	}
}

func TestWorkflowStoreRejectsOversizedPayload(t *testing.T) {
	client := workflowRedisTestClient(t)
	t.Cleanup(func() { client.Close() })
	clearWorkflowStores(t, client, 1)
	t.Cleanup(func() { clearWorkflowStores(t, client, 1) })

	store := NewWorkflowStore(client, context.Background(), nil)
	ctx := context.Background()

	huge := validStoredWorkflowEntry("huge")
	huge.Message = strings.Repeat("x", maxWorkflowStoreBytes)
	if err := store.SaveWorkflows(ctx, 1, []WorkflowEntry{huge}); err == nil {
		t.Fatal("a payload at or above the store cap must be refused")
	}

	// A record that grew past the cap by other means is refused on read too.
	if err := client.Set(ctx, workflowStoreKey(1), strings.Repeat("y", maxWorkflowStoreBytes), 0).Err(); err != nil {
		t.Fatalf("fixture write failed: %v", err)
	}
	if entries, err := store.ListWorkflows(ctx, 1); err == nil {
		t.Fatalf("an oversized stored record must be an error, got %+v", entries)
	}
}

// A hand-written record naming another org still lists only under the key that
// holds it: the org stamp is server-owned on read as well as on write.
func TestWorkflowStoreStampsOwningOrgOnRead(t *testing.T) {
	client := workflowRedisTestClient(t)
	t.Cleanup(func() { client.Close() })
	clearWorkflowStores(t, client, 1)
	t.Cleanup(func() { clearWorkflowStores(t, client, 1) })

	ctx := context.Background()
	raw := `[{"name":"foreign","orgId":2,"skill":"investigating-alerts","toolAllowlist":["t"]}]`
	if err := client.Set(ctx, workflowStoreKey(1), raw, 0).Err(); err != nil {
		t.Fatalf("fixture write failed: %v", err)
	}

	store := NewWorkflowStore(client, ctx, nil)
	entries, err := store.ListWorkflows(ctx, 1)
	if err != nil || len(entries) != 1 {
		t.Fatalf("record must list for its key's org: %v %+v", err, entries)
	}
	if entries[0].OrgID != 1 {
		t.Fatalf("read entry must carry the key's org, got %d", entries[0].OrgID)
	}
}

func putWorkflowsBody(t *testing.T, entries []WorkflowEntry) string {
	t.Helper()
	var b strings.Builder
	b.WriteString(`{"workflows":[`)
	for i, entry := range entries {
		if i > 0 {
			b.WriteString(",")
		}
		raw, err := json.Marshal(entry)
		if err != nil {
			t.Fatalf("encode fixture entry failed: %v", err)
		}
		b.Write(raw)
	}
	b.WriteString(`]}`)
	return b.String()
}

func putWorkflowsRequest(t *testing.T, p *Plugin, orgID int64, role, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPut, "/api/workflows", strings.NewReader(body))
	req = withTestIdentity(req, orgID, "admin-1", role)
	rec := httptest.NewRecorder()
	p.handleWorkflows(rec, req)
	return rec
}

func getWorkflowsRequest(t *testing.T, p *Plugin, orgID int64, role string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/api/workflows", nil)
	req = withTestIdentity(req, orgID, "admin-1", role)
	rec := httptest.NewRecorder()
	p.handleWorkflows(rec, req)
	return rec
}

// errInjectedReadBack is the fault the hook below reports for a read-back GET.
var errInjectedReadBack = errors.New("injected read-back failure")

// readBackFailHook fails GET of one workflow store key only after that key's
// SET succeeded, so a test can exercise a persisted save whose read-back fails.
type readBackFailHook struct {
	key   string
	saved atomic.Bool
}

func (h *readBackFailHook) DialHook(next redis.DialHook) redis.DialHook { return next }

func (h *readBackFailHook) ProcessHook(next redis.ProcessHook) redis.ProcessHook {
	return func(ctx context.Context, cmd redis.Cmder) error {
		args := cmd.Args()
		key := ""
		if len(args) > 1 {
			key, _ = args[1].(string)
		}
		if key == h.key {
			switch cmd.Name() {
			case "set":
				if err := next(ctx, cmd); err != nil {
					return err
				}
				h.saved.Store(true)
				return nil
			case "get":
				if h.saved.Load() {
					return errInjectedReadBack
				}
			}
		}
		return next(ctx, cmd)
	}
}

func (h *readBackFailHook) ProcessPipelineHook(next redis.ProcessPipelineHook) redis.ProcessPipelineHook {
	return next
}

// TestHandleWorkflowSaveReadBackFailureReturnsSavedList: the save persisted, so
// a failed read-back answers 200 with the validated list. Reporting 500 would
// tell the admin a save failed when it succeeded.
func TestHandleWorkflowSaveReadBackFailureReturnsSavedList(t *testing.T) {
	p, client := newRedisBackedWorkflowPlugin(t)
	hook := &readBackFailHook{key: workflowStoreKey(1)}
	client.AddHook(hook)

	body := `{"workflows":[{"name":"saved-wf","enabled":true,` +
		`"skill":"investigating-alerts","intervalSeconds":300,"sessionTimeoutSeconds":420,` +
		`"toolAllowlist":["t"]}]}`
	rec := putWorkflowsRequest(t, p, 1, "Admin", body)
	if !hook.saved.Load() {
		t.Fatal("the fixture must exercise a persisted save")
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("a persisted save with a failed read-back must answer 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if names := workflowNamesFromGet(t, rec); len(names) != 1 || names[0] != "saved-wf" {
		t.Fatalf("the response must carry the saved list, got %v", names)
	}

	// The record really is stored: an unhooked client reads it back.
	probe := workflowRedisTestClient(t)
	t.Cleanup(func() { probe.Close() })
	raw, err := probe.Get(context.Background(), workflowStoreKey(1)).Result()
	if err != nil || !strings.Contains(raw, "saved-wf") {
		t.Fatalf("the save must have persisted despite the failed read-back: raw=%q err=%v", raw, err)
	}
}
