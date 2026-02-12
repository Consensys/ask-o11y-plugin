package plugin

import (
	"consensys-asko11y-app/pkg/agent"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
)

func TestRunStore_CreateRun(t *testing.T) {
	store := NewRunStore(log.DefaultLogger)

	run := store.CreateRun("run-1", 100, 1)

	if run.RunID != "run-1" {
		t.Errorf("expected RunID 'run-1', got '%s'", run.RunID)
	}
	if run.Status != RunStatusRunning {
		t.Errorf("expected status running, got '%s'", run.Status)
	}
	if run.UserID != 100 {
		t.Errorf("expected UserID 100, got %d", run.UserID)
	}
	if run.OrgID != 1 {
		t.Errorf("expected OrgID 1, got %d", run.OrgID)
	}
	if len(run.Events) != 0 {
		t.Errorf("expected 0 events, got %d", len(run.Events))
	}
}

func TestRunStore_AppendEvent(t *testing.T) {
	store := NewRunStore(log.DefaultLogger)
	store.CreateRun("run-1", 100, 1)

	store.AppendEvent("run-1", agent.SSEEvent{Type: "content", Data: agent.ContentEvent{Content: "hello"}})
	store.AppendEvent("run-1", agent.SSEEvent{Type: "done", Data: agent.DoneEvent{TotalIterations: 1}})

	run, err := store.GetRun("run-1")
	if err != nil {
		t.Fatalf("failed to get run: %v", err)
	}
	if len(run.Events) != 2 {
		t.Fatalf("expected 2 events, got %d", len(run.Events))
	}
	if run.Events[0].Type != "content" {
		t.Errorf("expected content event, got %q", run.Events[0].Type)
	}
}

func TestRunStore_AppendEvent_TrimsOldest(t *testing.T) {
	store := NewRunStore(log.DefaultLogger)
	store.CreateRun("run-1", 100, 1)

	for i := 0; i < RunMaxEventsPerRun+10; i++ {
		store.AppendEvent("run-1", agent.SSEEvent{
			Type: "content",
			Data: agent.ContentEvent{Content: fmt.Sprintf("msg-%d", i)},
		})
	}

	run, err := store.GetRun("run-1")
	if err != nil {
		t.Fatalf("failed to get run: %v", err)
	}
	if len(run.Events) != RunMaxEventsPerRun {
		t.Fatalf("expected %d events, got %d", RunMaxEventsPerRun, len(run.Events))
	}
	first := run.Events[0].Data.(agent.ContentEvent).Content
	if first != "msg-10" {
		t.Errorf("expected oldest kept event to be msg-10, got %q", first)
	}
	last := run.Events[len(run.Events)-1].Data.(agent.ContentEvent).Content
	expected := fmt.Sprintf("msg-%d", RunMaxEventsPerRun+9)
	if last != expected {
		t.Errorf("expected newest event to be %s, got %q", expected, last)
	}
}

func TestRunStore_AppendEvent_NonExistent(t *testing.T) {
	store := NewRunStore(log.DefaultLogger)
	store.AppendEvent("nonexistent", agent.SSEEvent{Type: "content", Data: agent.ContentEvent{Content: "x"}})
}

func TestRunStore_FinishRun(t *testing.T) {
	store := NewRunStore(log.DefaultLogger)
	store.CreateRun("run-1", 100, 1)

	store.FinishRun("run-1", RunStatusCompleted, "")

	run, err := store.GetRun("run-1")
	if err != nil {
		t.Fatalf("failed to get run: %v", err)
	}
	if run.Status != RunStatusCompleted {
		t.Errorf("expected completed, got %q", run.Status)
	}
}

func TestRunStore_FinishRun_WithError(t *testing.T) {
	store := NewRunStore(log.DefaultLogger)
	store.CreateRun("run-1", 100, 1)

	store.FinishRun("run-1", RunStatusFailed, "LLM error")

	run, _ := store.GetRun("run-1")
	if run.Status != RunStatusFailed {
		t.Errorf("expected failed, got %q", run.Status)
	}
	if run.Error != "LLM error" {
		t.Errorf("expected error 'LLM error', got %q", run.Error)
	}
}

func TestRunStore_GetRun_NotFound(t *testing.T) {
	store := NewRunStore(log.DefaultLogger)

	_, err := store.GetRun("nonexistent")
	if err == nil {
		t.Error("expected error for non-existent run")
	}
	if err.Error() != "run not found" {
		t.Errorf("expected 'run not found', got %q", err.Error())
	}
}

func TestRunStore_CleanupOld(t *testing.T) {
	store := NewRunStore(log.DefaultLogger)

	store.CreateRun("old-run", 100, 1)
	store.FinishRun("old-run", RunStatusCompleted, "")

	// Backdate the run
	store.mu.Lock()
	store.runs["old-run"].UpdatedAt = time.Now().Add(-2 * RunMaxAge)
	store.mu.Unlock()

	store.CreateRun("new-run", 100, 1)
	store.FinishRun("new-run", RunStatusCompleted, "")

	store.CleanupOld()

	_, err := store.GetRun("old-run")
	if err == nil {
		t.Error("old run should have been cleaned up")
	}

	_, err = store.GetRun("new-run")
	if err != nil {
		t.Error("new run should still exist")
	}
}

func TestRunStore_CleanupOld_SkipsRunning(t *testing.T) {
	store := NewRunStore(log.DefaultLogger)

	store.CreateRun("running-run", 100, 1)
	store.mu.Lock()
	store.runs["running-run"].UpdatedAt = time.Now().Add(-2 * RunMaxAge)
	store.mu.Unlock()

	store.CleanupOld()

	_, err := store.GetRun("running-run")
	if err != nil {
		t.Error("running runs should not be cleaned up even if old")
	}
}

func TestRunBroadcaster_SubscribeAndBroadcast(t *testing.T) {
	b := newRunBroadcaster()

	ch, unsub := b.Subscribe()
	defer unsub()

	event := agent.SSEEvent{Type: "content", Data: agent.ContentEvent{Content: "test"}}
	b.Broadcast(event)

	select {
	case received := <-ch:
		if received.Type != "content" {
			t.Errorf("expected content event, got %q", received.Type)
		}
	default:
		t.Error("expected to receive event")
	}
}

func TestRunBroadcaster_MultipleSubscribers(t *testing.T) {
	b := newRunBroadcaster()

	ch1, unsub1 := b.Subscribe()
	defer unsub1()
	ch2, unsub2 := b.Subscribe()
	defer unsub2()

	event := agent.SSEEvent{Type: "content", Data: agent.ContentEvent{Content: "test"}}
	b.Broadcast(event)

	for i, ch := range []<-chan agent.SSEEvent{ch1, ch2} {
		select {
		case received := <-ch:
			if received.Type != "content" {
				t.Errorf("subscriber %d: expected content, got %q", i, received.Type)
			}
		default:
			t.Errorf("subscriber %d: expected to receive event", i)
		}
	}
}

func TestRunBroadcaster_Close(t *testing.T) {
	b := newRunBroadcaster()

	ch, _ := b.Subscribe()
	b.Close()

	_, ok := <-ch
	if ok {
		t.Error("channel should be closed after broadcaster.Close()")
	}
}

func TestRunBroadcaster_SubscribeAfterClose(t *testing.T) {
	b := newRunBroadcaster()
	b.Close()

	ch, _ := b.Subscribe()
	_, ok := <-ch
	if ok {
		t.Error("subscribing after close should return a closed channel")
	}
}

func TestIsValidSecureID(t *testing.T) {
	validID, err := generateShareID()
	if err != nil {
		t.Fatalf("failed to generate ID: %v", err)
	}
	if !isValidSecureID(validID) {
		t.Errorf("generated ID should be valid: %q", validID)
	}

	for _, invalid := range []string{"", "short", "has spaces in it", "../../etc/passwd", "run:injection"} {
		if isValidSecureID(invalid) {
			t.Errorf("expected invalid for %q", invalid)
		}
	}
}

func TestRunBroadcaster_ConcurrentAccess(t *testing.T) {
	b := newRunBroadcaster()
	var wg sync.WaitGroup

	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			ch, unsub := b.Subscribe()
			defer unsub()
			for range ch {
			}
		}()
	}

	for i := 0; i < 50; i++ {
		b.Broadcast(agent.SSEEvent{Type: "content", Data: agent.ContentEvent{Content: "x"}})
	}

	b.Close()
	wg.Wait()
}
