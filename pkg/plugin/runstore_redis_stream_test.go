package plugin

import (
	"consensys-asko11y-app/pkg/agent"
	"context"
	"testing"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
)

func waitForEvent(t *testing.T, ch <-chan agent.SSEEvent) agent.SSEEvent {
	t.Helper()
	select {
	case event, ok := <-ch:
		if !ok {
			t.Fatal("event channel closed before an event arrived")
		}
		return event
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for event")
		return agent.SSEEvent{}
	}
}

func TestRedisRunStore_StreamsEventsAcrossStores(t *testing.T) {
	client := createTestRedisClient(t)
	defer client.Close()

	ctx := context.Background()
	producer := NewRedisRunStore(ctx, client, log.DefaultLogger)
	consumer := NewRedisRunStore(ctx, client, log.DefaultLogger)

	producer.CreateRun("run-1", 100, 1, "session-1")

	run, ch, unsub, err := consumer.SubscribeAndSnapshot("run-1")
	if err != nil {
		t.Fatalf("SubscribeAndSnapshot failed: %v", err)
	}
	if ch == nil {
		t.Fatal("expected a live event channel for a running run on another replica")
	}
	defer unsub()
	if run.Status != RunStatusRunning {
		t.Fatalf("expected status running, got %q", run.Status)
	}

	producer.AppendEvent("run-1", agent.SSEEvent{Type: "content", Data: agent.ContentEvent{Content: "hello"}})

	event := waitForEvent(t, ch)
	if event.Type != "content" {
		t.Fatalf("expected content event, got %q", event.Type)
	}
	if event.Sequence != 0 {
		t.Fatalf("expected sequence 0, got %d", event.Sequence)
	}
}

func TestRedisRunStore_ClosesStreamWhenRunFinishes(t *testing.T) {
	client := createTestRedisClient(t)
	defer client.Close()

	ctx := context.Background()
	producer := NewRedisRunStore(ctx, client, log.DefaultLogger)
	consumer := NewRedisRunStore(ctx, client, log.DefaultLogger)

	producer.CreateRun("run-2", 100, 1)

	_, ch, unsub, err := consumer.SubscribeAndSnapshot("run-2")
	if err != nil {
		t.Fatalf("SubscribeAndSnapshot failed: %v", err)
	}
	if ch == nil {
		t.Fatal("expected a live event channel")
	}
	defer unsub()

	producer.AppendEvent("run-2", agent.SSEEvent{Type: "done", Data: agent.DoneEvent{TotalIterations: 1}})
	waitForEvent(t, ch)
	producer.FinishRun("run-2", RunStatusCompleted, "")

	select {
	case _, ok := <-ch:
		if ok {
			t.Fatal("expected the stream to close after the run finished")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for the stream to close")
	}
}

func TestRedisRunStore_FinishedRunHasNoLiveStream(t *testing.T) {
	client := createTestRedisClient(t)
	defer client.Close()

	store := NewRedisRunStore(context.Background(), client, log.DefaultLogger)
	store.CreateRun("run-3", 100, 1)
	store.AppendEvent("run-3", agent.SSEEvent{Type: "content", Data: agent.ContentEvent{Content: "hi"}})
	store.FinishRun("run-3", RunStatusCompleted, "")

	run, ch, unsub, err := store.SubscribeAndSnapshot("run-3")
	if err != nil {
		t.Fatalf("SubscribeAndSnapshot failed: %v", err)
	}
	if ch != nil {
		t.Fatal("expected no live channel for a finished run")
	}
	if unsub != nil {
		unsub()
	}
	if run.Status != RunStatusCompleted {
		t.Fatalf("expected status completed, got %q", run.Status)
	}
	if len(run.Events) != 1 {
		t.Fatalf("expected 1 replayed event, got %d", len(run.Events))
	}
}

func TestRedisRunStore_ReleasesSubscriptionAfterLastSubscriber(t *testing.T) {
	client := createTestRedisClient(t)
	defer client.Close()

	store := NewRedisRunStore(context.Background(), client, log.DefaultLogger)
	store.CreateRun("run-4", 100, 1)

	_, _, unsubA, err := store.SubscribeAndSnapshot("run-4")
	if err != nil {
		t.Fatalf("first SubscribeAndSnapshot failed: %v", err)
	}
	_, _, unsubB, err := store.SubscribeAndSnapshot("run-4")
	if err != nil {
		t.Fatalf("second SubscribeAndSnapshot failed: %v", err)
	}

	store.mu.RLock()
	sub := store.subscriptions["run-4"]
	store.mu.RUnlock()
	if sub == nil {
		t.Fatal("expected a shared subscription for the run")
	}

	unsubA()
	store.mu.RLock()
	stillOpen := store.subscriptions["run-4"] != nil
	store.mu.RUnlock()
	if !stillOpen {
		t.Fatal("subscription torn down while a subscriber was still attached")
	}

	unsubB()
	store.mu.RLock()
	remaining := len(store.subscriptions)
	store.mu.RUnlock()
	if remaining != 0 {
		t.Fatalf("expected the subscription to be released, got %d", remaining)
	}
}
