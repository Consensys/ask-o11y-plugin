package plugin

import (
	"testing"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
)

func newTestSessionStore() *SessionStore {
	return NewSessionStore(log.DefaultLogger)
}

func TestSessionStore_CreateAndGet(t *testing.T) {
	store := newTestSessionStore()

	msgs := []SessionMessage{{Role: "user", Content: "hello"}}
	session, err := store.CreateSession(1, 1, "", msgs)
	if err != nil {
		t.Fatalf("CreateSession failed: %v", err)
	}
	if session.ID == "" {
		t.Fatal("expected non-empty session ID")
	}
	if session.Title != "hello" {
		t.Fatalf("expected title 'hello', got %q", session.Title)
	}
	if session.MessageCount != 1 {
		t.Fatalf("expected 1 message, got %d", session.MessageCount)
	}

	got, err := store.GetSession(session.ID, 1, 1)
	if err != nil {
		t.Fatalf("GetSession failed: %v", err)
	}
	if got.ID != session.ID {
		t.Fatalf("ID mismatch: %q vs %q", got.ID, session.ID)
	}
}

func TestSessionStore_UserIsolation(t *testing.T) {
	store := newTestSessionStore()

	msgs := []SessionMessage{{Role: "user", Content: "hello"}}
	session, _ := store.CreateSession(1, 1, "", msgs)

	_, err := store.GetSession(session.ID, 2, 1)
	if err == nil {
		t.Fatal("expected error accessing another user's session")
	}
}

func TestSessionStore_OrgIsolation(t *testing.T) {
	store := newTestSessionStore()

	msgs := []SessionMessage{{Role: "user", Content: "hello"}}
	session, _ := store.CreateSession(1, 1, "", msgs)

	_, err := store.GetSession(session.ID, 1, 2)
	if err == nil {
		t.Fatal("expected error accessing session in different org")
	}
}

func TestSessionStore_ListSessions(t *testing.T) {
	store := newTestSessionStore()

	store.CreateSession(1, 1, "first", []SessionMessage{{Role: "user", Content: "a"}})
	store.CreateSession(1, 1, "second", []SessionMessage{{Role: "user", Content: "b"}})
	store.CreateSession(2, 1, "other user", []SessionMessage{{Role: "user", Content: "c"}})

	sessions, err := store.ListSessions(1, 1)
	if err != nil {
		t.Fatalf("ListSessions failed: %v", err)
	}
	if len(sessions) != 2 {
		t.Fatalf("expected 2 sessions, got %d", len(sessions))
	}
	// Should be sorted newest first
	if sessions[0].Title != "second" {
		t.Fatalf("expected newest first, got %q", sessions[0].Title)
	}
}

func TestSessionStore_UpdateSession(t *testing.T) {
	store := newTestSessionStore()

	msgs := []SessionMessage{{Role: "user", Content: "hello"}}
	session, _ := store.CreateSession(1, 1, "", msgs)

	newTitle := "updated title"
	newSummary := "a summary"
	err := store.UpdateSession(session.ID, 1, 1, SessionUpdate{
		Title:   &newTitle,
		Summary: &newSummary,
		Messages: []SessionMessage{
			{Role: "user", Content: "hello"},
			{Role: "assistant", Content: "hi there"},
		},
	})
	if err != nil {
		t.Fatalf("UpdateSession failed: %v", err)
	}

	got, _ := store.GetSession(session.ID, 1, 1)
	if got.Title != "updated title" {
		t.Fatalf("expected updated title, got %q", got.Title)
	}
	if got.Summary != "a summary" {
		t.Fatalf("expected summary, got %q", got.Summary)
	}
	if got.MessageCount != 2 {
		t.Fatalf("expected 2 messages, got %d", got.MessageCount)
	}
}

func TestSessionStore_AppendMessages(t *testing.T) {
	store := newTestSessionStore()

	msgs := []SessionMessage{{Role: "user", Content: "hello"}}
	session, _ := store.CreateSession(1, 1, "", msgs)

	err := store.AppendMessages(session.ID, 1, 1, []SessionMessage{
		{Role: "assistant", Content: "hi"},
	})
	if err != nil {
		t.Fatalf("AppendMessages failed: %v", err)
	}

	got, _ := store.GetSession(session.ID, 1, 1)
	if got.MessageCount != 2 {
		t.Fatalf("expected 2 messages, got %d", got.MessageCount)
	}
}

func TestSessionStore_DeleteSession(t *testing.T) {
	store := newTestSessionStore()

	msgs := []SessionMessage{{Role: "user", Content: "hello"}}
	session, _ := store.CreateSession(1, 1, "", msgs)

	err := store.DeleteSession(session.ID, 1, 1)
	if err != nil {
		t.Fatalf("DeleteSession failed: %v", err)
	}

	_, err = store.GetSession(session.ID, 1, 1)
	if err == nil {
		t.Fatal("expected error after deletion")
	}
}

func TestSessionStore_DeleteAllSessions(t *testing.T) {
	store := newTestSessionStore()

	store.CreateSession(1, 1, "a", []SessionMessage{{Role: "user", Content: "a"}})
	store.CreateSession(1, 1, "b", []SessionMessage{{Role: "user", Content: "b"}})

	err := store.DeleteAllSessions(1, 1)
	if err != nil {
		t.Fatalf("DeleteAllSessions failed: %v", err)
	}

	sessions, _ := store.ListSessions(1, 1)
	if len(sessions) != 0 {
		t.Fatalf("expected 0 sessions, got %d", len(sessions))
	}
}

func TestSessionStore_MaxSessionsEviction(t *testing.T) {
	store := newTestSessionStore()

	for i := 0; i < SessionMaxPerUserOrg; i++ {
		store.CreateSession(1, 1, "", []SessionMessage{{Role: "user", Content: "msg"}})
	}

	sessions, _ := store.ListSessions(1, 1)
	if len(sessions) != SessionMaxPerUserOrg {
		t.Fatalf("expected %d sessions, got %d", SessionMaxPerUserOrg, len(sessions))
	}

	// One more should evict the oldest
	store.CreateSession(1, 1, "newest", []SessionMessage{{Role: "user", Content: "new"}})

	sessions, _ = store.ListSessions(1, 1)
	if len(sessions) != SessionMaxPerUserOrg {
		t.Fatalf("expected %d sessions after eviction, got %d", SessionMaxPerUserOrg, len(sessions))
	}
}

func TestSessionStore_CurrentSession(t *testing.T) {
	store := newTestSessionStore()

	session, _ := store.CreateSession(1, 1, "", []SessionMessage{{Role: "user", Content: "hello"}})

	id, _ := store.GetCurrentSessionID(1, 1)
	if id != "" {
		t.Fatalf("expected empty current session, got %q", id)
	}

	err := store.SetCurrentSessionID(1, 1, session.ID)
	if err != nil {
		t.Fatalf("SetCurrentSessionID failed: %v", err)
	}

	id, _ = store.GetCurrentSessionID(1, 1)
	if id != session.ID {
		t.Fatalf("expected %q, got %q", session.ID, id)
	}

	store.ClearCurrentSessionID(1, 1)
	id, _ = store.GetCurrentSessionID(1, 1)
	if id != "" {
		t.Fatalf("expected empty after clear, got %q", id)
	}
}

func TestSessionStore_ActiveRunID(t *testing.T) {
	store := newTestSessionStore()

	session, _ := store.CreateSession(1, 1, "", []SessionMessage{{Role: "user", Content: "hello"}})

	err := store.SetActiveRunID(session.ID, 1, 1, "run-123")
	if err != nil {
		t.Fatalf("SetActiveRunID failed: %v", err)
	}

	got, _ := store.GetSession(session.ID, 1, 1)
	if got.ActiveRunID != "run-123" {
		t.Fatalf("expected run-123, got %q", got.ActiveRunID)
	}

	err = store.ClearActiveRunID(session.ID, 1, 1)
	if err != nil {
		t.Fatalf("ClearActiveRunID failed: %v", err)
	}

	got, _ = store.GetSession(session.ID, 1, 1)
	if got.ActiveRunID != "" {
		t.Fatalf("expected empty after clear, got %q", got.ActiveRunID)
	}
}

func TestSessionStore_TitleGeneration(t *testing.T) {
	store := newTestSessionStore()

	session, _ := store.CreateSession(1, 1, "", []SessionMessage{
		{Role: "assistant", Content: "welcome"},
		{Role: "user", Content: "What is the meaning of life?"},
	})

	if session.Title != "What is the meaning of life?" {
		t.Fatalf("expected title from first user message, got %q", session.Title)
	}
}

func TestSessionStore_ExplicitTitle(t *testing.T) {
	store := newTestSessionStore()

	session, _ := store.CreateSession(1, 1, "My Title", []SessionMessage{
		{Role: "user", Content: "hello"},
	})

	if session.Title != "My Title" {
		t.Fatalf("expected explicit title, got %q", session.Title)
	}
}

func TestSessionStore_DeleteClearsCurrentSession(t *testing.T) {
	store := newTestSessionStore()

	session, _ := store.CreateSession(1, 1, "", []SessionMessage{{Role: "user", Content: "hello"}})
	store.SetCurrentSessionID(1, 1, session.ID)

	store.DeleteSession(session.ID, 1, 1)

	id, _ := store.GetCurrentSessionID(1, 1)
	if id != "" {
		t.Fatalf("expected empty current session after deleting it, got %q", id)
	}
}
