package plugin

import (
	"context"
	"testing"
)

func TestMemorySlackLinkPeekThenConsume(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	s := newMemorySlackLinkStore()
	const nonce = "abcdefghijklmnop"
	if err := s.setPending(ctx, nonce, "T1", "U1"); err != nil {
		t.Fatal(err)
	}
	t1, u1, ok := s.peekPending(ctx, nonce)
	if !ok || t1 != "T1" || u1 != "U1" {
		t.Fatalf("peek: ok=%v team=%q user=%q", ok, t1, u1)
	}
	t2, u2, ok := s.peekPending(ctx, nonce)
	if !ok || t2 != "T1" || u2 != "U1" {
		t.Fatalf("second peek: ok=%v", ok)
	}
	ct, cu, ok := s.consumePending(ctx, nonce)
	if !ok || ct != "T1" || cu != "U1" {
		t.Fatalf("consume: ok=%v", ok)
	}
	if _, _, ok := s.peekPending(ctx, nonce); ok {
		t.Fatal("peek after consume should be false")
	}
	if _, _, ok := s.consumePending(ctx, nonce); ok {
		t.Fatal("second consume should be false")
	}
}
