package plugin

import (
	"context"
	"errors"
	"testing"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
)

func TestOrgIdentityStoreSeedsInstanceBinding(t *testing.T) {
	store := NewOrgIdentityStore()

	if _, _, _, ok := store.Get(); ok {
		t.Fatal("unseeded instance must not resolve")
	}

	if err := store.Seed(42, "https://grafana.example", "token-1"); err != nil {
		t.Fatalf("first seed failed: %v", err)
	}
	orgID, url, token, ok := store.Get()
	if !ok || orgID != 42 || url != "https://grafana.example" || token != "token-1" {
		t.Fatalf("seeded instance must resolve: %d %q %q %v", orgID, url, token, ok)
	}

	// The same org refreshes the URL and the token, so a corrected URL or a
	// rotated token reaches the next tick.
	if err := store.Seed(42, "https://fixed.example", "token-2"); err != nil {
		t.Fatalf("same-org re-seed failed: %v", err)
	}
	orgID, url, token, ok = store.Get()
	if !ok || orgID != 42 || url != "https://fixed.example" || token != "token-2" {
		t.Fatalf("same org must refresh URL and token: %d %q %q %v", orgID, url, token, ok)
	}

	// An empty token never overwrites a known one.
	if err := store.Seed(42, "", ""); err != nil {
		t.Fatalf("same-org empty re-seed failed: %v", err)
	}
	if _, _, token, ok = store.Get(); !ok || token != "token-2" {
		t.Fatalf("empty seed must not clear the token: %q %v", token, ok)
	}

	// A URL without a token is not usable.
	fresh := NewOrgIdentityStore()
	if err := fresh.Seed(7, "https://grafana.example", ""); err != nil {
		t.Fatalf("seed without token failed: %v", err)
	}
	if _, _, _, ok := fresh.Get(); ok {
		t.Fatal("identity without a token must not resolve")
	}
}

// TestOrgIdentityStoreRejectsMismatchedSeed is C10: an instance bound to org A
// must reject a seed for org B outright instead of merging org A's org with
// org B's token.
func TestOrgIdentityStoreRejectsMismatchedSeed(t *testing.T) {
	store := NewOrgIdentityStore()
	if err := store.Seed(42, "https://grafana.example", "token-1"); err != nil {
		t.Fatalf("first seed failed: %v", err)
	}

	err := store.Seed(43, "https://other.example", "token-2")
	if !errors.Is(err, errOrgIdentityMismatch) {
		t.Fatalf("mismatched re-seed must return errOrgIdentityMismatch, got %v", err)
	}

	orgID, url, token, ok := store.Get()
	if !ok || orgID != 42 || url != "https://grafana.example" || token != "token-1" {
		t.Fatalf("mismatched re-seed must change nothing: %d %q %q %v", orgID, url, token, ok)
	}
}

func TestOrgIdentitySeedRejectsNonPositiveOrg(t *testing.T) {
	store := NewOrgIdentityStore()
	if err := store.Seed(0, "https://grafana.example", "token-1"); err == nil {
		t.Fatal("org ID 0 must be rejected")
	}
	if _, _, _, ok := store.Get(); ok {
		t.Fatal("rejected seed must not resolve")
	}
}

// TestPersistedOrgIdentitySurvivesRestart is the state-level refutation: the
// binding a request persists is what a fresh plugin instance (a settings save)
// loads before its workflows start.
func TestPersistedOrgIdentitySurvivesRestart(t *testing.T) {
	client := workflowRedisTestClient(t)
	defer client.Close()
	ctx := context.Background()
	if err := client.Del(ctx, orgIdentityRedisKey).Err(); err != nil {
		t.Fatalf("cleanup failed: %v", err)
	}
	t.Cleanup(func() { client.Del(context.Background(), orgIdentityRedisKey) })

	before := &Plugin{
		logger:      log.DefaultLogger,
		redisClient: client,
		usingRedis:  true,
		orgIdentity: NewOrgIdentityStore(),
		ctx:         ctx,
	}
	before.seedOrgIdentity(42, "https://grafana.example", "token-1")

	after := &Plugin{
		logger:      log.DefaultLogger,
		redisClient: client,
		usingRedis:  true,
		orgIdentity: NewOrgIdentityStore(),
		ctx:         ctx,
	}
	if _, _, _, ok := after.orgIdentity.Get(); ok {
		t.Fatal("the fresh instance must start empty")
	}
	after.loadPersistedOrgIdentity()

	orgID, url, token, ok := after.orgIdentity.Get()
	if !ok || orgID != 42 || url != "https://grafana.example" || token != "token-1" {
		t.Fatalf("persisted binding must restore: %d %q %q %v", orgID, url, token, ok)
	}
}

// TestPersistedOrgIdentityWithoutRedisDegrades covers the in-memory path: a
// seed still works for this instance, persistence is a no-op, and loading
// never blocks or panics.
func TestPersistedOrgIdentityWithoutRedisDegrades(t *testing.T) {
	p := &Plugin{
		logger:      log.DefaultLogger,
		orgIdentity: NewOrgIdentityStore(),
		ctx:         context.Background(),
	}
	p.seedOrgIdentity(42, "https://grafana.example", "token-1")
	if orgID, _, token, ok := p.orgIdentity.Get(); !ok || orgID != 42 || token != "token-1" {
		t.Fatalf("in-memory seed must still bind this instance: %d %q %v", orgID, token, ok)
	}

	restarted := &Plugin{
		logger:      log.DefaultLogger,
		orgIdentity: NewOrgIdentityStore(),
		ctx:         context.Background(),
	}
	restarted.loadPersistedOrgIdentity()
	if _, _, _, ok := restarted.orgIdentity.Get(); ok {
		t.Fatal("no Redis means no persisted identity, matching the lazy-seed behavior")
	}
}

func TestPersistedOrgIdentityIgnoresCorruptRecord(t *testing.T) {
	client := workflowRedisTestClient(t)
	defer client.Close()
	ctx := context.Background()
	if err := client.Set(ctx, orgIdentityRedisKey, "not-json", 0).Err(); err != nil {
		t.Fatalf("fixture write failed: %v", err)
	}
	t.Cleanup(func() { client.Del(context.Background(), orgIdentityRedisKey) })

	p := &Plugin{
		logger:      log.DefaultLogger,
		redisClient: client,
		usingRedis:  true,
		orgIdentity: NewOrgIdentityStore(),
		ctx:         ctx,
	}
	p.loadPersistedOrgIdentity()
	if _, _, _, ok := p.orgIdentity.Get(); ok {
		t.Fatal("a corrupt record must leave the store empty, not resolve")
	}
}
