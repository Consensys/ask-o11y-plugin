package plugin

import "testing"

func TestOrgIdentityStoreSeedAndGet(t *testing.T) {
	store := NewOrgIdentityStore()

	if _, _, ok := store.Get(42); ok {
		t.Fatal("unseeded org must not resolve")
	}

	store.Seed(42, "https://grafana.example", "token-1")
	url, token, ok := store.Get(42)
	if !ok || url != "https://grafana.example" || token != "token-1" {
		t.Fatalf("seeded org must resolve: %q %q %v", url, token, ok)
	}

	// Token refreshes on every seed; URL is write-once.
	store.Seed(42, "https://other.example", "token-2")
	url, token, ok = store.Get(42)
	if !ok || url != "https://grafana.example" || token != "token-2" {
		t.Fatalf("URL must stay write-once and token must refresh: %q %q %v", url, token, ok)
	}

	// An empty token never overwrites a known one.
	store.Seed(42, "", "")
	if _, token, ok = store.Get(42); !ok || token != "token-2" {
		t.Fatalf("empty seed must not clear the token: %q %v", token, ok)
	}

	// Orgs are isolated from each other.
	if _, _, ok := store.Get(43); ok {
		t.Fatal("other org must stay unseeded")
	}

	// Invalid org IDs are ignored.
	store.Seed(0, "https://grafana.example", "token")
	if _, _, ok := store.Get(0); ok {
		t.Fatal("org 0 must never resolve")
	}

	// A URL without a token is not usable.
	fresh := NewOrgIdentityStore()
	fresh.Seed(7, "https://grafana.example", "")
	if _, _, ok := fresh.Get(7); ok {
		t.Fatal("identity without a token must not resolve")
	}
}
