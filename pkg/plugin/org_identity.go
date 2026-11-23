package plugin

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"sync"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	"github.com/redis/go-redis/v9"
)

// orgIdentityRedisKey returns the Redis record holding one org's binding. Each
// Grafana org has its own record, so a multi-org deployment never shares an
// identity: the key is org-scoped and follows the dynamic-server store
// precedent (no TTL), because the token is a long-lived Grafana-managed
// service-account token, not a short-lived request credential.
func orgIdentityRedisKey(orgID int64) string {
	return "org_identity:" + strconv.FormatInt(orgID, 10)
}

// persistedOrgIdentity is the on-wire format for orgIdentityRedisKey.
type persistedOrgIdentity struct {
	OrgID      int64  `json:"orgId"`
	GrafanaURL string `json:"grafanaUrl"`
	SAToken    string `json:"saToken"`
}

// orgIdentity is one org's usable binding: the Grafana URL and the
// service-account token.
type orgIdentity struct {
	grafanaURL string
	saToken    string
}

// OrgIdentityStore holds the lazily captured bindings of every org this
// plugin instance has served. Each Grafana org seeds its own entry from its
// own inbound requests; workflows read the entry of the org they belong to.
// Until an org is seeded its workflows skip with a warning, and other orgs are
// unaffected.
type OrgIdentityStore struct {
	mu      sync.RWMutex
	entries map[int64]orgIdentity
	// redisClient, ctx, and logger are wired once by attachRedis. A nil client
	// keeps the store in memory only, matching the no-Redis deployment.
	redisClient *redis.Client
	ctx         context.Context
	logger      log.Logger
}

func NewOrgIdentityStore() *OrgIdentityStore {
	return &OrgIdentityStore{
		entries: make(map[int64]orgIdentity),
		logger:  log.DefaultLogger,
	}
}

// attachRedis wires the per-org persistence and read-through fallback. It is
// called once by NewPlugin; a nil client leaves the store in memory only.
func (s *OrgIdentityStore) attachRedis(client *redis.Client, ctx context.Context, logger log.Logger) {
	if client == nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.redisClient = client
	s.ctx = ctx
	if logger != nil {
		s.logger = logger
	}
}

// Seed records the org's Grafana URL and service-account token in memory and
// persists them under the org's own Redis key. URL and token carry the last
// non-empty value (a same-org re-seed refreshes both), so a corrected URL or a
// rotated token is picked up by the next workflow tick of that org.
//
// A seed for one org never touches another org's entry: org B can seed while
// org A is bound, and each resolves only its own identity. Seed returns an
// error only for a non-positive org ID; an unavailable Redis degrades to the
// in-memory path and is logged, never returned.
func (s *OrgIdentityStore) Seed(orgID int64, grafanaURL, saToken string) error {
	if orgID <= 0 {
		return fmt.Errorf("org identity seed requires a positive org ID, got %d", orgID)
	}

	s.mu.Lock()
	if s.entries == nil {
		s.entries = make(map[int64]orgIdentity)
	}
	entry := s.entries[orgID]
	if grafanaURL != "" {
		entry.grafanaURL = grafanaURL
	}
	if saToken != "" {
		entry.saToken = saToken
	}
	s.entries[orgID] = entry
	client, ctx, logger := s.redisClient, s.ctx, s.logger
	s.mu.Unlock()

	if client == nil || entry.grafanaURL == "" || entry.saToken == "" {
		return nil
	}
	raw, err := json.Marshal(persistedOrgIdentity{
		OrgID:      orgID,
		GrafanaURL: entry.grafanaURL,
		SAToken:    entry.saToken,
	})
	if err != nil {
		logger.Warn("Failed to encode org identity", "orgId", orgID, "error", err)
		return nil
	}
	if ctx == nil {
		ctx = context.Background()
	}
	opCtx, cancel := redisContext(ctx, RedisOpTimeout)
	defer cancel()
	if err := client.Set(opCtx, orgIdentityRedisKey(orgID), raw, 0).Err(); err != nil {
		logger.Warn("Failed to persist org identity; this org's workflow ticks after a settings save will wait for its next request",
			"orgId", orgID, "error", err)
	}
	return nil
}

// GetForOrg returns one org's binding and whether it is usable. Memory answers
// first; on a miss the per-org Redis record is read and cached, so a fresh
// plugin instance (after a settings save) resolves the org without a pre-load.
// A missing, corrupt, or foreign record leaves that org unseeded — and only
// that org: another org's entry stays untouched.
func (s *OrgIdentityStore) GetForOrg(orgID int64) (string, string, bool) {
	if orgID <= 0 {
		return "", "", false
	}

	s.mu.RLock()
	entry, ok := s.entries[orgID]
	client, ctx, logger := s.redisClient, s.ctx, s.logger
	s.mu.RUnlock()
	if ok && entry.grafanaURL != "" && entry.saToken != "" {
		return entry.grafanaURL, entry.saToken, true
	}
	if client == nil {
		return "", "", false
	}

	if ctx == nil {
		ctx = context.Background()
	}
	opCtx, cancel := redisContext(ctx, RedisOpTimeout)
	defer cancel()
	raw, err := client.Get(opCtx, orgIdentityRedisKey(orgID)).Result()
	if errors.Is(err, redis.Nil) {
		return "", "", false
	}
	if err != nil {
		logger.Warn("Failed to load persisted org identity; this org's workflow ticks wait for its next request",
			"orgId", orgID, "error", err)
		return "", "", false
	}
	var rec persistedOrgIdentity
	if err := json.Unmarshal([]byte(raw), &rec); err != nil {
		logger.Warn("Ignoring corrupt persisted org identity", "orgId", orgID, "error", err)
		return "", "", false
	}
	if rec.OrgID != orgID || rec.GrafanaURL == "" || rec.SAToken == "" {
		logger.Warn("Ignoring unusable persisted org identity", "orgId", orgID)
		return "", "", false
	}

	s.mu.Lock()
	if s.entries == nil {
		s.entries = make(map[int64]orgIdentity)
	}
	s.entries[orgID] = orgIdentity{grafanaURL: rec.GrafanaURL, saToken: rec.SAToken}
	s.mu.Unlock()
	return rec.GrafanaURL, rec.SAToken, true
}

// SoleOrgID reports the one org this instance currently holds a usable
// identity for. It is the transitional single-org hook: an entry with no org
// stamp of its own (0) runs as that org, which keeps a single-org deployment
// behaving exactly as before. Two bound orgs make the answer ambiguous and
// report false, so the entry skips instead of running as the wrong org.
func (s *OrgIdentityStore) SoleOrgID() (int64, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	sole := int64(0)
	for orgID, entry := range s.entries {
		if entry.grafanaURL == "" || entry.saToken == "" {
			continue
		}
		if sole != 0 && sole != orgID {
			return 0, false
		}
		sole = orgID
	}
	return sole, sole != 0
}

// seedOrgIdentity is the request-path entry point used by handleAgentRun: it
// records the request's org binding, which mirrors it to that org's Redis
// record so the next plugin instance resolves it. Best effort: a rejected or
// unpersistable seed never fails the chat request, because the request's own
// token is still valid for it.
func (p *Plugin) seedOrgIdentity(orgID int64, grafanaURL, saToken string) {
	if p.orgIdentity == nil {
		return
	}
	if err := p.orgIdentity.Seed(orgID, grafanaURL, saToken); err != nil {
		p.logger.Warn("Org identity seed rejected; workflow tick identity unchanged",
			"orgId", orgID, "error", err)
	}
}
