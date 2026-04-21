package oauth

import (
	"context"
	"testing"
	"time"
)

func TestInMemoryUserTokenStore(t *testing.T) {
	s := NewInMemoryUserTokenStore()
	ctx := context.Background()

	tok := Token{AccessToken: "a", ExpiresAt: time.Now().Add(time.Hour)}
	if err := s.Put(ctx, "atlassian", 42, tok); err != nil {
		t.Fatalf("put: %v", err)
	}

	got, ok, err := s.Get(ctx, "atlassian", 42)
	if err != nil || !ok || got.AccessToken != "a" {
		t.Fatalf("get: ok=%v err=%v got=%+v", ok, err, got)
	}

	if _, ok, _ := s.Get(ctx, "atlassian", 99); ok {
		t.Fatalf("unexpected token for other user")
	}
	if _, ok, _ := s.Get(ctx, "other", 42); ok {
		t.Fatalf("unexpected token for other server")
	}

	if err := s.Delete(ctx, "atlassian", 42); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if _, ok, _ := s.Get(ctx, "atlassian", 42); ok {
		t.Fatalf("token still present after delete")
	}
}

func TestTokenExpiryHelpers(t *testing.T) {
	past := Token{ExpiresAt: time.Now().Add(-time.Minute)}
	if !past.Expired() {
		t.Fatalf("expected past token to be expired")
	}
	if !past.NeedsRefresh() {
		t.Fatalf("expected past token to need refresh")
	}

	soon := Token{ExpiresAt: time.Now().Add(30 * time.Second)}
	if soon.Expired() {
		t.Fatalf("token expiring in 30s should not be reported as expired")
	}
	if !soon.NeedsRefresh() {
		t.Fatalf("token expiring in 30s should need refresh (60s threshold)")
	}

	future := Token{ExpiresAt: time.Now().Add(2 * time.Hour)}
	if future.Expired() || future.NeedsRefresh() {
		t.Fatalf("future token should neither be expired nor need refresh")
	}
}
