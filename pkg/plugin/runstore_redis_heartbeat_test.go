package plugin

import (
	"consensys-asko11y-app/pkg/agent"
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	"github.com/redis/go-redis/v9"
)

func seedRunningRun(t *testing.T, client *redis.Client, runID string, age time.Duration) {
	t.Helper()

	updatedAt := time.Now().Add(-age)
	run := AgentRun{
		RunID:     runID,
		Status:    RunStatusRunning,
		UserID:    100,
		OrgID:     1,
		CreatedAt: updatedAt,
		UpdatedAt: updatedAt,
		Events:    []agent.SSEEvent{},
		Trace:     &AgentRunTrace{},
	}
	payload, err := json.Marshal(run)
	if err != nil {
		t.Fatalf("failed to marshal seeded run: %v", err)
	}

	ctx := context.Background()
	if err := client.Set(ctx, runKey(runID), payload, RunMaxAge).Err(); err != nil {
		t.Fatalf("failed to seed run: %v", err)
	}
	if err := client.ZAdd(ctx, runIndexKey(100, 1), redis.Z{Score: float64(updatedAt.UnixNano()), Member: runID}).Err(); err != nil {
		t.Fatalf("failed to index seeded run: %v", err)
	}
}

func TestRedisRunStore_CreateRunWritesHeartbeat(t *testing.T) {
	client := createTestRedisClient(t)
	defer client.Close()

	store := NewRedisRunStore(context.Background(), client, log.DefaultLogger)
	store.CreateRun("run-hb-1", 100, 1)

	ttl, err := client.TTL(context.Background(), heartbeatKey("run-hb-1")).Result()
	if err != nil {
		t.Fatalf("TTL failed: %v", err)
	}
	if ttl <= 0 || ttl > RunHeartbeatTTL {
		t.Fatalf("expected a heartbeat TTL within %s, got %s", RunHeartbeatTTL, ttl)
	}
}

func TestRedisRunStore_FinishRunClearsHeartbeat(t *testing.T) {
	client := createTestRedisClient(t)
	defer client.Close()

	store := NewRedisRunStore(context.Background(), client, log.DefaultLogger)
	store.CreateRun("run-hb-2", 100, 1)
	store.FinishRun("run-hb-2", RunStatusCompleted, "")

	exists, err := client.Exists(context.Background(), heartbeatKey("run-hb-2")).Result()
	if err != nil {
		t.Fatalf("Exists failed: %v", err)
	}
	if exists != 0 {
		t.Fatal("expected the heartbeat to be cleared when the run finished")
	}
}

func TestRedisRunStore_FinishRunStopsHeartbeatWhenRunIsGone(t *testing.T) {
	client := createTestRedisClient(t)
	defer client.Close()

	store := NewRedisRunStore(context.Background(), client, log.DefaultLogger)
	store.CreateRun("run-hb-3", 100, 1)
	if err := client.Del(context.Background(), runKey("run-hb-3")).Err(); err != nil {
		t.Fatalf("failed to drop the run key: %v", err)
	}

	store.FinishRun("run-hb-3", RunStatusCompleted, "")

	store.mu.RLock()
	remaining := len(store.heartbeats)
	store.mu.RUnlock()
	if remaining != 0 {
		t.Fatalf("expected the heartbeat refresher to stop even when the run could not be loaded, got %d", remaining)
	}
}

func TestRedisRunStore_GetRunFailsAbandonedRun(t *testing.T) {
	client := createTestRedisClient(t)
	defer client.Close()

	store := NewRedisRunStore(context.Background(), client, log.DefaultLogger)
	seedRunningRun(t, client, "run-orphan", 2*RunHeartbeatTTL)

	run, err := store.GetRun("run-orphan")
	if err != nil {
		t.Fatalf("GetRun failed: %v", err)
	}
	if run.Status != RunStatusFailed {
		t.Fatalf("expected status failed, got %q", run.Status)
	}
	if run.Error != runInterruptedMessage {
		t.Fatalf("expected the interrupted message, got %q", run.Error)
	}
	if len(run.Events) != 1 || run.Events[0].Type != "error" {
		t.Fatalf("expected a single terminal error event, got %+v", run.Events)
	}

	stored, err := store.GetRun("run-orphan")
	if err != nil {
		t.Fatalf("second GetRun failed: %v", err)
	}
	if stored.Status != RunStatusFailed {
		t.Fatalf("expected the failure to be persisted, got %q", stored.Status)
	}
	if len(stored.Events) != 1 {
		t.Fatalf("expected the error event to be appended once, got %d", len(stored.Events))
	}
}

func TestRedisRunStore_GetRunKeepsHeartbeatingRunRunning(t *testing.T) {
	client := createTestRedisClient(t)
	defer client.Close()

	store := NewRedisRunStore(context.Background(), client, log.DefaultLogger)
	seedRunningRun(t, client, "run-slow", 2*RunHeartbeatTTL)
	if err := client.Set(context.Background(), heartbeatKey("run-slow"), "1", RunHeartbeatTTL).Err(); err != nil {
		t.Fatalf("failed to seed heartbeat: %v", err)
	}

	run, err := store.GetRun("run-slow")
	if err != nil {
		t.Fatalf("GetRun failed: %v", err)
	}
	if run.Status != RunStatusRunning {
		t.Fatalf("a heartbeating run must stay running, got %q", run.Status)
	}
}

func TestRedisRunStore_GetRunKeepsRecentRunRunning(t *testing.T) {
	client := createTestRedisClient(t)
	defer client.Close()

	store := NewRedisRunStore(context.Background(), client, log.DefaultLogger)
	seedRunningRun(t, client, "run-fresh", time.Second)

	run, err := store.GetRun("run-fresh")
	if err != nil {
		t.Fatalf("GetRun failed: %v", err)
	}
	if run.Status != RunStatusRunning {
		t.Fatalf("a recently updated run must stay running, got %q", run.Status)
	}
}

func TestRedisRunStore_ListRunsFailsAbandonedRun(t *testing.T) {
	client := createTestRedisClient(t)
	defer client.Close()

	store := NewRedisRunStore(context.Background(), client, log.DefaultLogger)
	seedRunningRun(t, client, "run-orphan-list", 2*RunHeartbeatTTL)

	runs, err := store.ListRuns(100, 1, 10)
	if err != nil {
		t.Fatalf("ListRuns failed: %v", err)
	}
	if len(runs) != 1 {
		t.Fatalf("expected 1 run, got %d", len(runs))
	}
	if runs[0].Status != RunStatusFailed {
		t.Fatalf("expected status failed, got %q", runs[0].Status)
	}
}

func TestRedisRunStore_ReconcileIsClaimedOnce(t *testing.T) {
	client := createTestRedisClient(t)
	defer client.Close()

	ctx := context.Background()
	storeA := NewRedisRunStore(ctx, client, log.DefaultLogger)
	storeB := NewRedisRunStore(ctx, client, log.DefaultLogger)
	seedRunningRun(t, client, "run-orphan-race", 2*RunHeartbeatTTL)

	if _, err := storeA.GetRun("run-orphan-race"); err != nil {
		t.Fatalf("storeA GetRun failed: %v", err)
	}
	runB, err := storeB.GetRun("run-orphan-race")
	if err != nil {
		t.Fatalf("storeB GetRun failed: %v", err)
	}
	if runB.Status != RunStatusFailed {
		t.Fatalf("expected status failed on the second replica, got %q", runB.Status)
	}
	if len(runB.Events) != 1 {
		t.Fatalf("expected exactly one terminal error event, got %d", len(runB.Events))
	}
}
