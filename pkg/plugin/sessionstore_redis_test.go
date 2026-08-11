package plugin

import (
	"context"
	"testing"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
)

func TestRedisSessionStore_ModelRoundTrip(t *testing.T) {
	client := createTestRedisClient(t)
	defer client.Close()

	store := NewRedisSessionStore(context.Background(), client, log.DefaultLogger)
	session, err := store.CreateSession(1, 1, "test", []SessionMessage{{Role: "user", Content: "hello"}})
	if err != nil {
		t.Fatalf("CreateSession failed: %v", err)
	}

	model := "large"
	if err := store.UpdateSession(session.ID, 1, 1, SessionUpdate{Model: &model}); err != nil {
		t.Fatalf("UpdateSession failed: %v", err)
	}

	got, err := store.GetSession(session.ID, 1, 1)
	if err != nil {
		t.Fatalf("GetSession failed: %v", err)
	}
	if got.Model != "large" {
		t.Fatalf("expected model large, got %q", got.Model)
	}

	sessions, err := store.ListSessions(1, 1)
	if err != nil {
		t.Fatalf("ListSessions failed: %v", err)
	}
	if len(sessions) != 1 || sessions[0].Model != "large" {
		t.Fatalf("expected listed session model large, got %+v", sessions)
	}
}

func TestRedisSessionStore_IncrementStats(t *testing.T) {
	client := createTestRedisClient(t)
	defer client.Close()

	store := NewRedisSessionStore(context.Background(), client, log.DefaultLogger)
	session, err := store.CreateSession(1, 1, "test", []SessionMessage{{Role: "user", Content: "hello"}})
	if err != nil {
		t.Fatalf("CreateSession failed: %v", err)
	}

	delta := SessionStatsDelta{
		RunCount: 1, TotalIterations: 3, ToolCallCount: 2,
		PromptTokens: 100, CompletionTokens: 20, TotalTokens: 120,
	}
	if err := store.IncrementStats(session.ID, 1, 1, delta); err != nil {
		t.Fatalf("IncrementStats failed: %v", err)
	}
	if err := store.IncrementStats(session.ID, 1, 1, delta); err != nil {
		t.Fatalf("IncrementStats (second call) failed: %v", err)
	}

	got, err := store.GetSession(session.ID, 1, 1)
	if err != nil {
		t.Fatalf("GetSession failed: %v", err)
	}
	if got.RunCount != 2 || got.TotalIterations != 6 || got.ToolCallCount != 4 {
		t.Fatalf("unexpected accumulated counts: %+v", got)
	}
	if got.PromptTokens != 200 || got.CompletionTokens != 40 || got.TotalTokens != 240 {
		t.Fatalf("unexpected accumulated tokens: %+v", got)
	}

	if err := store.IncrementStats(session.ID, 2, 1, delta); err == nil {
		t.Fatal("expected error incrementing stats for another user's session")
	}
}
