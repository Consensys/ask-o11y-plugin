package plugin

import (
	"encoding/json"
	"errors"
	"fmt"
	"sync"

	"github.com/redis/go-redis/v9"
)

// orgIdentityRedisKey is the single Redis record holding this instance's org
// binding. A settings save builds a fresh plugin instance; restoring this
// record before the workflows start keeps their ticks running without waiting
// for a human to chat in the org first. It follows the dynamic-server store
// precedent (one global key, no TTL): the token is a long-lived Grafana-managed
// service-account token, not a short-lived request credential.
const orgIdentityRedisKey = "org_identity"

// errOrgIdentityMismatch reports a seed for an org other than the one this
// instance already serves. The instance is single-org by design, so a
// mismatched seed is a routing fault, never a merge.
var errOrgIdentityMismatch = errors.New("org identity already bound to a different org")

// persistedOrgIdentity is the on-wire format for orgIdentityRedisKey.
type persistedOrgIdentity struct {
	OrgID      int64  `json:"orgId"`
	GrafanaURL string `json:"grafanaUrl"`
	SAToken    string `json:"saToken"`
}

// OrgIdentityStore holds the lazily captured org binding of this plugin
// instance: every Grafana org gets its own app instance, so the first
// inbound request to this instance names the org it serves, its Grafana URL,
// and its service-account token. Workflow schedulers read the same binding;
// until it is seeded they skip with a warning, exactly like Scout.
type OrgIdentityStore struct {
	mu      sync.RWMutex
	orgID   int64
	url     string
	saToken string
}

func NewOrgIdentityStore() *OrgIdentityStore {
	return &OrgIdentityStore{}
}

// Seed records the org (write-once), the Grafana URL, and the
// service-account token (both refreshed on every seed of the same org), so a
// corrected URL or rotated token is picked up by the next workflow tick.
//
// A seed for a different org is rejected with errOrgIdentityMismatch and
// writes nothing: merging org A's binding with org B's token would make every
// tick act in the wrong org.
func (s *OrgIdentityStore) Seed(orgID int64, grafanaURL, saToken string) error {
	if orgID <= 0 {
		return fmt.Errorf("org identity seed requires a positive org ID, got %d", orgID)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.orgID != 0 && s.orgID != orgID {
		return fmt.Errorf("%w: bound to org %d, got org %d", errOrgIdentityMismatch, s.orgID, orgID)
	}
	s.orgID = orgID
	if grafanaURL != "" {
		s.url = grafanaURL
	}
	if saToken != "" {
		s.saToken = saToken
	}
	return nil
}

// Get returns the instance binding and whether it is usable: a workflow tick
// skips (and says so) until org, URL, and token are all present.
func (s *OrgIdentityStore) Get() (orgID int64, grafanaURL, saToken string, ok bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.orgID == 0 || s.url == "" || s.saToken == "" {
		return 0, "", "", false
	}
	return s.orgID, s.url, s.saToken, true
}

// seedOrgIdentity is the request-path entry point used by handleAgentRun: it
// records the request's org binding and mirrors it to Redis so the next plugin
// instance (after any settings save) starts its workflows with identity.
// Best effort throughout: a rejected or unpersistable seed never fails the
// chat request, because the request's own token is still valid for it.
func (p *Plugin) seedOrgIdentity(orgID int64, grafanaURL, saToken string) {
	if p.orgIdentity == nil {
		return
	}
	if err := p.orgIdentity.Seed(orgID, grafanaURL, saToken); err != nil {
		p.logger.Warn("Org identity seed rejected; workflow tick identity unchanged",
			"orgId", orgID, "error", err)
		return
	}
	p.persistOrgIdentity()
}

// persistOrgIdentity mirrors the current binding into Redis. Failure only
// degrades the next instance to the previous lazy-seed behavior, so it is
// logged rather than propagated.
func (p *Plugin) persistOrgIdentity() {
	if p.redisClient == nil || !p.usingRedis {
		return
	}
	orgID, grafanaURL, saToken, ok := p.orgIdentity.Get()
	if !ok {
		return
	}
	raw, err := json.Marshal(persistedOrgIdentity{
		OrgID:      orgID,
		GrafanaURL: grafanaURL,
		SAToken:    saToken,
	})
	if err != nil {
		p.logger.Warn("Failed to encode org identity", "error", err)
		return
	}
	ctx, cancel := redisContext(p.ctx, RedisOpTimeout)
	defer cancel()
	if err := p.redisClient.Set(ctx, orgIdentityRedisKey, raw, 0).Err(); err != nil {
		p.logger.Warn("Failed to persist org identity; workflow ticks after a settings save will wait for the first request",
			"error", err)
	}
}

// loadPersistedOrgIdentity restores the binding persisted by an earlier
// plugin instance. NewPlugin calls it before startWorkflows so the first tick
// after a settings save has identity. Redis unavailable, a missing record, or
// a corrupt one leaves the store empty: ticks then skip until a request seeds
// it, exactly as before, and never block NewPlugin.
func (p *Plugin) loadPersistedOrgIdentity() {
	if p.orgIdentity == nil || p.redisClient == nil || !p.usingRedis {
		return
	}
	ctx, cancel := redisContext(p.ctx, RedisOpTimeout)
	defer cancel()
	raw, err := p.redisClient.Get(ctx, orgIdentityRedisKey).Result()
	if errors.Is(err, redis.Nil) {
		return
	}
	if err != nil {
		p.logger.Warn("Failed to load persisted org identity; workflow ticks will wait for the first request",
			"error", err)
		return
	}
	var rec persistedOrgIdentity
	if err := json.Unmarshal([]byte(raw), &rec); err != nil {
		p.logger.Warn("Ignoring corrupt persisted org identity", "error", err)
		return
	}
	if err := p.orgIdentity.Seed(rec.OrgID, rec.GrafanaURL, rec.SAToken); err != nil {
		p.logger.Warn("Ignoring unusable persisted org identity", "error", err)
		return
	}
	p.logger.Info("Restored org identity for workflow ticks", "orgId", rec.OrgID)
}
