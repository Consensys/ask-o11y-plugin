package plugin

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	"github.com/redis/go-redis/v9"
)

const (
	slackPendingKeyPrefix  = "asko11y:slack:pending:"
	slackLinkKeyPrefix     = "asko11y:slack:link:"
	slackRevLinkKeyPrefix  = "asko11y:slack:revlink:"
	slackPendingTTL        = 15 * time.Minute
	slackRoleStaleDuration = 24 * time.Hour
)

type slackPendingPayload struct {
	TeamID      string `json:"teamId"`
	SlackUserID string `json:"slackUserId"`
}

type slackLinkRecord struct {
	UserID   int64  `json:"userId"`
	OrgID    int64  `json:"orgId"`
	Role     string `json:"role"`
	LinkedAt int64  `json:"linkedAt"` // Unix timestamp; 0 means legacy record
}

func slackLinkKey(teamID, slackUserID string) string {
	return teamID + ":" + slackUserID
}

func slackGrafanaUserKey(userID, orgID int64) string {
	return fmt.Sprintf("%d:%d", userID, orgID)
}

type slackLinkStore interface {
	// Pending link ops
	setPending(ctx context.Context, nonce, teamID, slackUserID string) error
	peekPending(ctx context.Context, nonce string) (teamID, slackUserID string, ok bool)
	consumePending(ctx context.Context, nonce string) (teamID, slackUserID string, ok bool)
	// CleanupExpired removes stale pending entries (no-op for Redis which uses TTL).
	CleanupExpired()

	// Link ops
	setLink(ctx context.Context, teamID, slackUserID string, userID, orgID int64, role string) error
	getLink(ctx context.Context, teamID, slackUserID string) (userID, orgID int64, role string, linkedAt time.Time, ok bool)
	deleteLink(ctx context.Context, teamID, slackUserID string) error
	// getLinkByGrafanaUser enables reverse lookup for unlink-by-Grafana-session.
	getLinkByGrafanaUser(ctx context.Context, userID, orgID int64) (teamID, slackUserID string, ok bool)
}

// ─── In-memory store ────────────────────────────────────────────────────────

type memorySlackLinkStore struct {
	mu           sync.Mutex
	pending      map[string]struct {
		slackPendingPayload
		expiresAt time.Time
	}
	links        map[string]slackLinkRecord // key: teamID:slackUserID
	reverseLinks map[string]string          // key: userID:orgID → teamID:slackUserID
}

func newMemorySlackLinkStore() *memorySlackLinkStore {
	return &memorySlackLinkStore{
		pending: make(map[string]struct {
			slackPendingPayload
			expiresAt time.Time
		}),
		links:        make(map[string]slackLinkRecord),
		reverseLinks: make(map[string]string),
	}
}

func (s *memorySlackLinkStore) setPending(_ context.Context, nonce, teamID, slackUserID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.pending[nonce] = struct {
		slackPendingPayload
		expiresAt time.Time
	}{
		slackPendingPayload: slackPendingPayload{TeamID: teamID, SlackUserID: slackUserID},
		expiresAt:           time.Now().Add(slackPendingTTL),
	}
	return nil
}

func (s *memorySlackLinkStore) peekPending(_ context.Context, nonce string) (string, string, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	e, ok := s.pending[nonce]
	if !ok {
		return "", "", false
	}
	if time.Now().After(e.expiresAt) {
		delete(s.pending, nonce)
		return "", "", false
	}
	return e.TeamID, e.SlackUserID, true
}

func (s *memorySlackLinkStore) consumePending(_ context.Context, nonce string) (string, string, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	e, ok := s.pending[nonce]
	if !ok {
		return "", "", false
	}
	delete(s.pending, nonce)
	if time.Now().After(e.expiresAt) {
		return "", "", false
	}
	return e.TeamID, e.SlackUserID, true
}

func (s *memorySlackLinkStore) CleanupExpired() {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	for k, v := range s.pending {
		if now.After(v.expiresAt) {
			delete(s.pending, k)
		}
	}
}

func (s *memorySlackLinkStore) setLink(_ context.Context, teamID, slackUserID string, userID, orgID int64, role string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	key := slackLinkKey(teamID, slackUserID)
	// Remove stale reverse entry if re-linking to a different Grafana identity.
	if old, ok := s.links[key]; ok {
		delete(s.reverseLinks, slackGrafanaUserKey(old.UserID, old.OrgID))
	}
	rec := slackLinkRecord{UserID: userID, OrgID: orgID, Role: role, LinkedAt: time.Now().Unix()}
	s.links[key] = rec
	s.reverseLinks[slackGrafanaUserKey(userID, orgID)] = key
	return nil
}

func (s *memorySlackLinkStore) getLink(_ context.Context, teamID, slackUserID string) (int64, int64, string, time.Time, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	rec, ok := s.links[slackLinkKey(teamID, slackUserID)]
	if !ok {
		return 0, 0, "", time.Time{}, false
	}
	return rec.UserID, rec.OrgID, rec.Role, time.Unix(rec.LinkedAt, 0), true
}

func (s *memorySlackLinkStore) deleteLink(_ context.Context, teamID, slackUserID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	key := slackLinkKey(teamID, slackUserID)
	rec, ok := s.links[key]
	if !ok {
		return nil
	}
	delete(s.links, key)
	delete(s.reverseLinks, slackGrafanaUserKey(rec.UserID, rec.OrgID))
	return nil
}

func (s *memorySlackLinkStore) getLinkByGrafanaUser(_ context.Context, userID, orgID int64) (string, string, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	combined, ok := s.reverseLinks[slackGrafanaUserKey(userID, orgID)]
	if !ok {
		return "", "", false
	}
	// combined is "teamID:slackUserID" — split on the FIRST colon only.
	idx := strings.Index(combined, ":")
	if idx < 0 {
		return "", "", false
	}
	return combined[:idx], combined[idx+1:], true
}

// ─── Redis store ─────────────────────────────────────────────────────────────

type redisSlackLinkStore struct {
	client *redis.Client
	logger log.Logger
}

func newRedisSlackLinkStore(client *redis.Client, logger log.Logger) *redisSlackLinkStore {
	return &redisSlackLinkStore{client: client, logger: logger}
}

func (s *redisSlackLinkStore) setPending(ctx context.Context, nonce, teamID, slackUserID string) error {
	payload, err := json.Marshal(slackPendingPayload{TeamID: teamID, SlackUserID: slackUserID})
	if err != nil {
		return err
	}
	c, cancel := redisContext(ctx, RedisOpTimeout)
	defer cancel()
	return s.client.Set(c, slackPendingKeyPrefix+nonce, payload, slackPendingTTL).Err()
}

func (s *redisSlackLinkStore) peekPending(ctx context.Context, nonce string) (string, string, bool) {
	key := slackPendingKeyPrefix + nonce
	c, cancel := redisContext(ctx, RedisOpTimeout)
	defer cancel()
	data, err := s.client.Get(c, key).Bytes()
	if err == redis.Nil || len(data) == 0 {
		return "", "", false
	}
	if err != nil {
		s.logger.Warn("slack pending peek", "error", err)
		return "", "", false
	}
	var p slackPendingPayload
	if err := json.Unmarshal(data, &p); err != nil || p.TeamID == "" || p.SlackUserID == "" {
		return "", "", false
	}
	return p.TeamID, p.SlackUserID, true
}

func (s *redisSlackLinkStore) consumePending(ctx context.Context, nonce string) (string, string, bool) {
	key := slackPendingKeyPrefix + nonce
	c, cancel := redisContext(ctx, RedisOpTimeout)
	defer cancel()
	data, err := s.client.GetDel(c, key).Bytes()
	if err == redis.Nil || len(data) == 0 {
		return "", "", false
	}
	if err != nil {
		s.logger.Warn("slack pending consume", "error", err)
		return "", "", false
	}
	var p slackPendingPayload
	if err := json.Unmarshal(data, &p); err != nil || p.TeamID == "" || p.SlackUserID == "" {
		return "", "", false
	}
	return p.TeamID, p.SlackUserID, true
}

// CleanupExpired is a no-op: Redis TTL handles expiry automatically.
func (s *redisSlackLinkStore) CleanupExpired() {}

func (s *redisSlackLinkStore) setLink(ctx context.Context, teamID, slackUserID string, userID, orgID int64, role string) error {
	rec := slackLinkRecord{UserID: userID, OrgID: orgID, Role: role, LinkedAt: time.Now().Unix()}
	data, err := json.Marshal(rec)
	if err != nil {
		return err
	}
	linkKey := slackLinkKeyPrefix + slackLinkKey(teamID, slackUserID)
	revKey := slackRevLinkKeyPrefix + slackGrafanaUserKey(userID, orgID)
	combined := slackLinkKey(teamID, slackUserID)

	// Remove stale reverse-link if this Slack identity was previously linked
	// to a different Grafana user (mirrors memorySlackLinkStore.setLink).
	c, cancel := redisContext(ctx, RedisOpTimeout)
	defer cancel()
	oldData, err := s.client.Get(c, linkKey).Bytes()
	if err == nil {
		var old slackLinkRecord
		if json.Unmarshal(oldData, &old) == nil {
			oldRevKey := slackRevLinkKeyPrefix + slackGrafanaUserKey(old.UserID, old.OrgID)
			if oldRevKey != revKey {
				s.client.Del(c, oldRevKey)
			}
		}
	}

	pipe := s.client.Pipeline()
	pipe.Set(c, linkKey, data, 0)
	pipe.Set(c, revKey, combined, 0)
	_, err = pipe.Exec(c)
	return err
}

func (s *redisSlackLinkStore) getLink(ctx context.Context, teamID, slackUserID string) (int64, int64, string, time.Time, bool) {
	c, cancel := redisContext(ctx, RedisOpTimeout)
	defer cancel()
	data, err := s.client.Get(c, slackLinkKeyPrefix+slackLinkKey(teamID, slackUserID)).Bytes()
	if err == redis.Nil {
		return 0, 0, "", time.Time{}, false
	}
	if err != nil {
		s.logger.Warn("slack link get", "error", err)
		return 0, 0, "", time.Time{}, false
	}
	var rec slackLinkRecord
	if err := json.Unmarshal(data, &rec); err != nil {
		return 0, 0, "", time.Time{}, false
	}
	return rec.UserID, rec.OrgID, rec.Role, time.Unix(rec.LinkedAt, 0), true
}

func (s *redisSlackLinkStore) deleteLink(ctx context.Context, teamID, slackUserID string) error {
	linkKey := slackLinkKeyPrefix + slackLinkKey(teamID, slackUserID)

	// Fetch the record first to resolve the reverse key.
	c, cancel := redisContext(ctx, RedisOpTimeout)
	defer cancel()
	data, err := s.client.Get(c, linkKey).Bytes()
	if err == redis.Nil {
		return nil // already gone
	}
	if err != nil {
		return err
	}
	var rec slackLinkRecord
	if err := json.Unmarshal(data, &rec); err != nil {
		return err
	}
	revKey := slackRevLinkKeyPrefix + slackGrafanaUserKey(rec.UserID, rec.OrgID)

	c2, cancel2 := redisContext(ctx, RedisOpTimeout)
	defer cancel2()
	return s.client.Del(c2, linkKey, revKey).Err()
}

func (s *redisSlackLinkStore) getLinkByGrafanaUser(ctx context.Context, userID, orgID int64) (string, string, bool) {
	c, cancel := redisContext(ctx, RedisOpTimeout)
	defer cancel()
	combined, err := s.client.Get(c, slackRevLinkKeyPrefix+slackGrafanaUserKey(userID, orgID)).Result()
	if err == redis.Nil {
		return "", "", false
	}
	if err != nil {
		s.logger.Warn("slack revlink get", "error", err)
		return "", "", false
	}
	idx := strings.Index(combined, ":")
	if idx < 0 {
		return "", "", false
	}
	return combined[:idx], combined[idx+1:], true
}
