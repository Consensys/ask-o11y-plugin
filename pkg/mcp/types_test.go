package mcp

import "testing"

func TestBoolPtrTrueOnly(t *testing.T) {
	t.Parallel()
	t.Run("false maps to nil for RBAC unspecified semantics", func(t *testing.T) {
		t.Parallel()
		if p := boolPtrTrueOnly(false); p != nil {
			t.Fatalf("got %v, want nil (SDK uses plain bool; false must not become non-nil *false)", p)
		}
	})
	t.Run("true maps to pointer true", func(t *testing.T) {
		t.Parallel()
		p := boolPtrTrueOnly(true)
		if p == nil || !*p {
			t.Fatalf("got %v, want *true", p)
		}
	})
}
