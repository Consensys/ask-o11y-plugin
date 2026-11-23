package plugin

import "testing"

func TestOrgIdentityStoreSeedsInstanceBinding(t *testing.T) {
	store := NewOrgIdentityStore()

	if _, _, _, ok := store.Get(); ok {
		t.Fatal("unseeded instance must not resolve")
	}

	store.Seed(42, "https://grafana.example", "token-1")
	orgID, url, token, ok := store.Get()
	if !ok || orgID != 42 || url != "https://grafana.example" || token != "token-1" {
		t.Fatalf("seeded instance must resolve: %d %q %q %v", orgID, url, token, ok)
	}

	// The org and URL are write-once; the token refreshes every seed.
	store.Seed(43, "https://other.example", "token-2")
	orgID, url, token, ok = store.Get()
	if !ok || orgID != 42 || url != "https://grafana.example" || token != "token-2" {
		t.Fatalf("org and URL must stay write-once, token must refresh: %d %q %q %v", orgID, url, token, ok)
	}

	// An empty token never overwrites a known one.
	store.Seed(0, "", "")
	if _, _, token, ok = store.Get(); !ok || token != "token-2" {
		t.Fatalf("empty seed must not clear the token: %q %v", token, ok)
	}

	// A URL without a token is not usable.
	fresh := NewOrgIdentityStore()
	fresh.Seed(7, "https://grafana.example", "")
	if _, _, _, ok := fresh.Get(); ok {
		t.Fatal("identity without a token must not resolve")
	}
}
