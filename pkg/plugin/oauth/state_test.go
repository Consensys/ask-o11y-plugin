package oauth

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestInMemoryStateStoreRoundTrip(t *testing.T) {
	s := NewInMemoryStateStore()
	ctx := context.Background()

	state, err := NewState()
	if err != nil {
		t.Fatalf("NewState: %v", err)
	}
	if err := s.Put(ctx, state, StateEntry{ServerID: "atlassian", UserID: 42, CodeVerifier: "v"}); err != nil {
		t.Fatalf("put: %v", err)
	}

	got, err := s.PopAndGet(ctx, state)
	if err != nil {
		t.Fatalf("popAndGet: %v", err)
	}
	if got.ServerID != "atlassian" || got.UserID != 42 || got.CodeVerifier != "v" {
		t.Fatalf("unexpected entry: %+v", got)
	}

	// Replay must fail.
	if _, err := s.PopAndGet(ctx, state); !errors.Is(err, ErrStateInvalid) {
		t.Fatalf("expected ErrStateInvalid on replay, got %v", err)
	}
}

func TestInMemoryStateStoreExpiry(t *testing.T) {
	s := NewInMemoryStateStore()
	ctx := context.Background()
	// Insert an entry manually with a stale CreatedAt to force expiry.
	s.entries["stale"] = StateEntry{CreatedAt: time.Now().Add(-2 * StateTTL)}
	if _, err := s.PopAndGet(ctx, "stale"); !errors.Is(err, ErrStateInvalid) {
		t.Fatalf("expected expired state to be rejected, got %v", err)
	}
}

func TestPKCEPair(t *testing.T) {
	v, c, err := NewPKCEPair()
	if err != nil {
		t.Fatalf("NewPKCEPair: %v", err)
	}
	if v == "" || c == "" {
		t.Fatalf("empty verifier/challenge")
	}
	v2, c2, _ := NewPKCEPair()
	if v == v2 || c == c2 {
		t.Fatalf("PKCE pair not random across calls")
	}
}

func TestContextRoundTrip(t *testing.T) {
	ctx := WithUserID(context.Background(), 0)
	if _, ok := UserIDFromContext(ctx); ok {
		t.Fatalf("zero user ID should not be stored")
	}
	ctx = WithUserID(context.Background(), 7)
	if v, ok := UserIDFromContext(ctx); !ok || v != 7 {
		t.Fatalf("expected 7, got %d ok=%v", v, ok)
	}
}
