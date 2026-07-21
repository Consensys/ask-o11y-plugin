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
