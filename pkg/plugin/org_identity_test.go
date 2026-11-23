package plugin

import (
	"context"
	"testing"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
)

func TestOrgIdentityStoreSeedsPerOrg(t *testing.T) {
	store := NewOrgIdentityStore()

	if _, _, ok := store.GetForOrg(42); ok {
		t.Fatal("unseeded org must not resolve")
	}

	if err := store.Seed(42, "https://grafana.example", "token-1"); err != nil {
		t.Fatalf("first seed failed: %v", err)
	}
	url, token, ok := store.GetForOrg(42)
	if !ok || url != "https://grafana.example" || token != "token-1" {
		t.Fatalf("seeded org must resolve: %q %q %v", url, token, ok)
	}

	// The same org refreshes the URL and the token, so a corrected URL or a
	// rotated token reaches the next tick.
	if err := store.Seed(42, "https://fixed.example", "token-2"); err != nil {
		t.Fatalf("same-org re-seed failed: %v", err)
	}
	url, token, ok = store.GetForOrg(42)
	if !ok || url != "https://fixed.example" || token != "token-2" {
		t.Fatalf("same org must refresh URL and token: %q %q %v", url, token, ok)
	}

	// An empty token never overwrites a known one.
	if err := store.Seed(42, "", ""); err != nil {
		t.Fatalf("same-org empty re-seed failed: %v", err)
	}
	if _, token, ok = store.GetForOrg(42); !ok || token != "token-2" {
		t.Fatalf("empty seed must not clear the token: %q %v", token, ok)
	}

	// A URL without a token is not usable.
	fresh := NewOrgIdentityStore()
	if err := fresh.Seed(7, "https://grafana.example", ""); err != nil {
		t.Fatalf("seed without token failed: %v", err)
	}
	if _, _, ok := fresh.GetForOrg(7); ok {
		t.Fatal("identity without a token must not resolve")
	}
}

// TestOrgIdentityStoreSeedsTwoOrgsIndependently replaces the old single-org
// mismatch rule: org B may seed while org A is bound, and each resolves only
// its own binding.
func TestOrgIdentityStoreSeedsTwoOrgsIndependently(t *testing.T) {
	store := NewOrgIdentityStore()
	if err := store.Seed(42, "https://grafana.example", "token-1"); err != nil {
		t.Fatalf("org 42 seed failed: %v", err)
	}
	if err := store.Seed(43, "https://other.example", "token-2"); err != nil {
		t.Fatalf("org 43 seed must be accepted, got %v", err)
	}

	url, token, ok := store.GetForOrg(42)
	if !ok || url != "https://grafana.example" || token != "token-1" {
		t.Fatalf("org 42 binding changed: %q %q %v", url, token, ok)
	}
	url, token, ok = store.GetForOrg(43)
	if !ok || url != "https://other.example" || token != "token-2" {
		t.Fatalf("org 43 must resolve its own binding: %q %q %v", url, token, ok)
	}
	if _, _, ok := store.GetForOrg(44); ok {
		t.Fatal("an org that never seeded must not resolve")
	}
}

func TestOrgIdentitySeedRejectsNonPositiveOrg(t *testing.T) {
	store := NewOrgIdentityStore()
	if err := store.Seed(0, "https://grafana.example", "token-1"); err == nil {
		t.Fatal("org ID 0 must be rejected")
	}
	if err := store.Seed(-3, "https://grafana.example", "token-1"); err == nil {
		t.Fatal("negative org ID must be rejected")
	}
	if _, _, ok := store.GetForOrg(0); ok {
		t.Fatal("org ID 0 must never resolve")
	}
}

// TestPersistedOrgIdentityPerOrgRoundTrip is the state-level refutation: the
// binding a request persists under one org's key is what a fresh plugin
// instance resolves for that org, and only for that org.
func TestPersistedOrgIdentityPerOrgRoundTrip(t *testing.T) {
	client := workflowRedisTestClient(t)
	defer client.Close()
	ctx := context.Background()
	t.Cleanup(func() { client.FlushDB(context.Background()) })

	before := &Plugin{
		logger:      log.DefaultLogger,
		redisClient: client,
		usingRedis:  true,
		orgIdentity: NewOrgIdentityStore(),
		ctx:         ctx,
	}
	before.orgIdentity.attachRedis(client, ctx, log.DefaultLogger)
	before.seedOrgIdentity(42, "https://grafana.example", "token-1")

	after := &Plugin{
		logger:      log.DefaultLogger,
		redisClient: client,
		usingRedis:  true,
		orgIdentity: NewOrgIdentityStore(),
		ctx:         ctx,
	}
	after.orgIdentity.attachRedis(client, ctx, log.DefaultLogger)
	if _, _, ok := after.orgIdentity.GetForOrg(42); !ok {
		t.Fatal("the fresh instance must resolve org 42 from its persisted record")
	}
	url, token, ok := after.orgIdentity.GetForOrg(42)
	if !ok || url != "https://grafana.example" || token != "token-1" {
		t.Fatalf("persisted binding must restore: %q %q %v", url, token, ok)
	}
	if _, _, ok := after.orgIdentity.GetForOrg(43); ok {
		t.Fatal("org 43 must not see org 42's record")
	}
}

// TestGetForOrgCachesRedisHit proves the read-through caches the record in
// memory: after the key is gone the org still resolves without another GET.
func TestGetForOrgCachesRedisHit(t *testing.T) {
	client := workflowRedisTestClient(t)
	defer client.Close()
	ctx := context.Background()
	t.Cleanup(func() { client.FlushDB(context.Background()) })

	seeded := &Plugin{
		logger:      log.DefaultLogger,
		redisClient: client,
		usingRedis:  true,
		orgIdentity: NewOrgIdentityStore(),
		ctx:         ctx,
	}
	seeded.orgIdentity.attachRedis(client, ctx, log.DefaultLogger)
	seeded.seedOrgIdentity(5, "https://grafana.example", "token-5")

	fresh := NewOrgIdentityStore()
	fresh.attachRedis(client, ctx, log.DefaultLogger)
	if _, _, ok := fresh.GetForOrg(5); !ok {
		t.Fatal("fallback GET must resolve the persisted org")
	}
	if err := client.Del(ctx, orgIdentityRedisKey(5)).Err(); err != nil {
		t.Fatalf("key removal failed: %v", err)
	}
	if _, token, ok := fresh.GetForOrg(5); !ok || token != "token-5" {
		t.Fatal("a resolved org must be cached in memory")
	}
}

// TestPersistedOrgIdentityWithoutRedisDegrades covers the in-memory path: a
// seed still works for this instance, and there is nothing to read back.
func TestPersistedOrgIdentityWithoutRedisDegrades(t *testing.T) {
	p := &Plugin{
		logger:      log.DefaultLogger,
		orgIdentity: NewOrgIdentityStore(),
		ctx:         context.Background(),
	}
	p.seedOrgIdentity(42, "https://grafana.example", "token-1")
	if url, token, ok := p.orgIdentity.GetForOrg(42); !ok || token != "token-1" || url == "" {
		t.Fatalf("in-memory seed must still bind this org: %q %q %v", url, token, ok)
	}

	restarted := &Plugin{
		logger:      log.DefaultLogger,
		orgIdentity: NewOrgIdentityStore(),
		ctx:         context.Background(),
	}
	if _, _, ok := restarted.orgIdentity.GetForOrg(42); ok {
		t.Fatal("no Redis means no persisted identity, matching the lazy-seed behavior")
	}
}

func TestPersistedOrgIdentityIgnoresCorruptRecord(t *testing.T) {
	client := workflowRedisTestClient(t)
	defer client.Close()
	ctx := context.Background()
	if err := client.Set(ctx, orgIdentityRedisKey(42), "not-json", 0).Err(); err != nil {
		t.Fatalf("fixture write failed: %v", err)
	}
	t.Cleanup(func() { client.FlushDB(context.Background()) })

	p := NewOrgIdentityStore()
	p.attachRedis(client, ctx, log.DefaultLogger)
	if _, _, ok := p.GetForOrg(42); ok {
		t.Fatal("a corrupt record must leave the org unseeded, not resolve")
	}
}

// TestGetForOrgRejectsForeignRecord guards the read path: a record stored under
// the wrong org key must not bind its org.
func TestGetForOrgRejectsForeignRecord(t *testing.T) {
	client := workflowRedisTestClient(t)
	defer client.Close()
	ctx := context.Background()
	if err := client.Set(ctx, orgIdentityRedisKey(43),
		`{"orgId":42,"grafanaUrl":"https://grafana.example","saToken":"token-1"}`, 0).Err(); err != nil {
		t.Fatalf("fixture write failed: %v", err)
	}
	t.Cleanup(func() { client.FlushDB(context.Background()) })

	p := NewOrgIdentityStore()
	p.attachRedis(client, ctx, log.DefaultLogger)
	if _, _, ok := p.GetForOrg(43); ok {
		t.Fatal("a record naming another org must not resolve")
	}
}
