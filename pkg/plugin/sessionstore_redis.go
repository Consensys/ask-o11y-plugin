package plugin

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	"github.com/redis/go-redis/v9"
)

func sessionKey(id string) string         { return fmt.Sprintf("session:%s", id) }
func sessionUserIdxKey(userID, orgID int64) string {
	return fmt.Sprintf("usersessions:%d:%d", userID, orgID)
}
func sessionCurrentKey(userID, orgID int64) string {
	return fmt.Sprintf("usersessions:%d:%d:current", userID, orgID)
}

// redisSession is the on-wire format stored in Redis (includes owner fields).
type redisSession struct {
	ID           string           `json:"id"`
	Title        string           `json:"title"`
	Messages     []SessionMessage `json:"messages"`
	Summary      string           `json:"summary,omitempty"`
	CreatedAt    time.Time        `json:"createdAt"`
	UpdatedAt    time.Time        `json:"updatedAt"`
	ExpiresAt    *time.Time       `json:"expiresAt,omitempty"`
	MessageCount int              `json:"messageCount"`
	ActiveRunID  string           `json:"activeRunId,omitempty"`
	UserID       int64            `json:"userId"`
	OrgID        int64            `json:"orgId"`
}

func toRedis(s *ChatSession) *redisSession {
	return &redisSession{
		ID: s.ID, Title: s.Title, Messages: s.Messages,
		Summary: s.Summary, CreatedAt: s.CreatedAt, UpdatedAt: s.UpdatedAt,
		ExpiresAt: s.ExpiresAt, MessageCount: s.MessageCount, ActiveRunID: s.ActiveRunID,
		UserID: s.UserID, OrgID: s.OrgID,
	}
}

func fromRedis(rs *redisSession) *ChatSession {
	return &ChatSession{
		ID: rs.ID, Title: rs.Title, Messages: rs.Messages,
		Summary: rs.Summary, CreatedAt: rs.CreatedAt, UpdatedAt: rs.UpdatedAt,
		ExpiresAt: rs.ExpiresAt, MessageCount: rs.MessageCount, ActiveRunID: rs.ActiveRunID,
		UserID: rs.UserID, OrgID: rs.OrgID,
	}
}

type RedisSessionStore struct {
	client *redis.Client
	logger log.Logger
}

func NewRedisSessionStore(client *redis.Client, logger log.Logger) *RedisSessionStore {
	return &RedisSessionStore{client: client, logger: logger}
}

func (s *RedisSessionStore) CreateSession(userID, orgID int64, title string, messages []SessionMessage, ttl time.Duration) (*ChatSession, error) {
	idxKey := sessionUserIdxKey(userID, orgID)

	ctx, cancel := getContextWithTimeout(RedisOpTimeout)
	defer cancel()
	count, err := s.client.SCard(ctx, idxKey).Result()
	if err != nil && err != redis.Nil {
		return nil, fmt.Errorf("failed to count sessions: %w", err)
	}
	if count >= int64(SessionMaxPerUserOrg) {
		if err := s.evictOldest(userID, orgID); err != nil {
			s.logger.Warn("Failed to evict oldest session", "error", err)
		}
	}

	id, err := generateShareID()
	if err != nil {
		return nil, fmt.Errorf("failed to generate session ID: %w", err)
	}

	if title == "" {
		title = generateSessionTitle(messages)
	}

	now := time.Now()
	expiresAt := now.Add(ttl)
	session := &ChatSession{
		ID: id, Title: title, Messages: messages,
		CreatedAt: now, UpdatedAt: now, ExpiresAt: &expiresAt, MessageCount: len(messages),
		UserID: userID, OrgID: orgID,
	}

	data, err := json.Marshal(toRedis(session))
	if err != nil {
		return nil, fmt.Errorf("failed to marshal session: %w", err)
	}

	ctx2, cancel2 := getContextWithTimeout(RedisOpTimeout)
	defer cancel2()
	if err := s.client.Set(ctx2, sessionKey(id), data, ttl).Err(); err != nil {
		return nil, fmt.Errorf("failed to store session: %w", err)
	}

	ctx3, cancel3 := getContextWithTimeout(RedisOpTimeout)
	defer cancel3()
	if err := s.client.SAdd(ctx3, idxKey, id).Err(); err != nil {
		s.client.Del(context.Background(), sessionKey(id))
		return nil, fmt.Errorf("failed to index session: %w", err)
	}

	return session, nil
}

func (s *RedisSessionStore) evictOldest(userID, orgID int64) error {
	sessions, err := s.ListSessions(userID, orgID)
	if err != nil || len(sessions) == 0 {
		return err
	}

	oldest := sessions[len(sessions)-1] // ListSessions sorts newest-first
	return s.DeleteSession(oldest.ID, userID, orgID)
}

func (s *RedisSessionStore) getSessionRaw(sessionID string) (*redisSession, error) {
	ctx, cancel := getContextWithTimeout(RedisOpTimeout)
	defer cancel()
	data, err := s.client.Get(ctx, sessionKey(sessionID)).Result()
	if err == redis.Nil {
		return nil, fmt.Errorf("session not found")
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get session: %w", err)
	}

	var rs redisSession
	if err := json.Unmarshal([]byte(data), &rs); err != nil {
		return nil, fmt.Errorf("failed to unmarshal session: %w", err)
	}
	return &rs, nil
}

func (s *RedisSessionStore) saveSession(session *ChatSession) error {
	data, err := json.Marshal(toRedis(session))
	if err != nil {
		return fmt.Errorf("failed to marshal session: %w", err)
	}

	var ttl time.Duration
	if session.ExpiresAt != nil {
		ttl = time.Until(*session.ExpiresAt)
		if ttl <= 0 {
			return fmt.Errorf("session already expired")
		}
	}

	ctx, cancel := getContextWithTimeout(RedisOpTimeout)
	defer cancel()
	return s.client.Set(ctx, sessionKey(session.ID), data, ttl).Err()
}

func (s *RedisSessionStore) GetSession(sessionID string, userID, orgID int64) (*ChatSession, error) {
	rs, err := s.getSessionRaw(sessionID)
	if err != nil {
		return nil, err
	}
	if rs.UserID != userID || rs.OrgID != orgID {
		return nil, fmt.Errorf("session not found")
	}

	if rs.ExpiresAt != nil && rs.ExpiresAt.Before(time.Now()) {
		ctx, cancel := getContextWithTimeout(RedisOpTimeout)
		defer cancel()
		s.client.Del(ctx, sessionKey(sessionID))
		s.client.SRem(ctx, sessionUserIdxKey(userID, orgID), sessionID)

		curKey := sessionCurrentKey(userID, orgID)
		cur, err := s.client.Get(ctx, curKey).Result()
		if err == nil && cur == sessionID {
			s.client.Del(ctx, curKey)
		}
		return nil, fmt.Errorf("session expired")
	}

	return fromRedis(rs), nil
}

func (s *RedisSessionStore) ListSessions(userID, orgID int64) ([]SessionMetadata, error) {
	idxKey := sessionUserIdxKey(userID, orgID)

	ctx, cancel := getContextWithTimeout(RedisBulkOpTimeout)
	defer cancel()
	ids, err := s.client.SMembers(ctx, idxKey).Result()
	if err != nil && err != redis.Nil {
		return nil, fmt.Errorf("failed to list sessions: %w", err)
	}

	if len(ids) == 0 {
		return []SessionMetadata{}, nil
	}

	keys := make([]string, len(ids))
	for i, id := range ids {
		keys[i] = sessionKey(id)
	}

	ctx2, cancel2 := getContextWithTimeout(RedisBulkOpTimeout)
	defer cancel2()
	values, err := s.client.MGet(ctx2, keys...).Result()
	if err != nil {
		return nil, fmt.Errorf("failed to get sessions: %w", err)
	}

	result := make([]SessionMetadata, 0, len(values))
	now := time.Now()
	for i, val := range values {
		if val == nil {
			// Stale index entry — remove it
			ctx3, cancel3 := getContextWithTimeout(RedisOpTimeout)
			s.client.SRem(ctx3, idxKey, ids[i])
			cancel3()
			continue
		}
		str, ok := val.(string)
		if !ok {
			continue
		}
		var rs redisSession
		if err := json.Unmarshal([]byte(str), &rs); err != nil {
			s.logger.Warn("Failed to unmarshal session", "error", err, "id", ids[i])
			continue
		}
		if rs.ExpiresAt != nil && rs.ExpiresAt.Before(now) {
			continue
		}
		result = append(result, SessionMetadata{
			ID: rs.ID, Title: rs.Title, CreatedAt: rs.CreatedAt,
			UpdatedAt: rs.UpdatedAt, ExpiresAt: rs.ExpiresAt, MessageCount: rs.MessageCount,
			ActiveRunID: rs.ActiveRunID,
		})
	}

	sort.Slice(result, func(i, j int) bool {
		return result[i].UpdatedAt.After(result[j].UpdatedAt)
	})

	return result, nil
}

func (s *RedisSessionStore) UpdateSession(sessionID string, userID, orgID int64, update SessionUpdate) error {
	rs, err := s.getSessionRaw(sessionID)
	if err != nil {
		return err
	}
	if rs.UserID != userID || rs.OrgID != orgID {
		return fmt.Errorf("session not found")
	}

	session := fromRedis(rs)
	if update.Messages != nil {
		session.Messages = update.Messages
		session.MessageCount = len(update.Messages)
	}
	if update.Title != nil {
		session.Title = *update.Title
	}
	if update.Summary != nil {
		session.Summary = *update.Summary
	}
	session.UpdatedAt = time.Now()

	return s.saveSession(session)
}

func (s *RedisSessionStore) AppendMessages(sessionID string, userID, orgID int64, messages []SessionMessage) error {
	rs, err := s.getSessionRaw(sessionID)
	if err != nil {
		return err
	}
	if rs.UserID != userID || rs.OrgID != orgID {
		return fmt.Errorf("session not found")
	}

	session := fromRedis(rs)
	session.Messages = append(session.Messages, messages...)
	session.MessageCount = len(session.Messages)
	session.UpdatedAt = time.Now()

	return s.saveSession(session)
}

func (s *RedisSessionStore) DeleteSession(sessionID string, userID, orgID int64) error {
	rs, err := s.getSessionRaw(sessionID)
	if err != nil {
		return err
	}
	if rs.UserID != userID || rs.OrgID != orgID {
		return fmt.Errorf("session not found")
	}

	ctx, cancel := getContextWithTimeout(RedisOpTimeout)
	defer cancel()
	s.client.Del(ctx, sessionKey(sessionID))

	ctx2, cancel2 := getContextWithTimeout(RedisOpTimeout)
	defer cancel2()
	s.client.SRem(ctx2, sessionUserIdxKey(userID, orgID), sessionID)

	curKey := sessionCurrentKey(userID, orgID)
	ctx3, cancel3 := getContextWithTimeout(RedisOpTimeout)
	defer cancel3()
	cur, err := s.client.Get(ctx3, curKey).Result()
	if err == nil && cur == sessionID {
		ctx4, cancel4 := getContextWithTimeout(RedisOpTimeout)
		defer cancel4()
		s.client.Del(ctx4, curKey)
	}

	return nil
}

func (s *RedisSessionStore) DeleteAllSessions(userID, orgID int64) error {
	idxKey := sessionUserIdxKey(userID, orgID)

	ctx, cancel := getContextWithTimeout(RedisBulkOpTimeout)
	defer cancel()
	ids, err := s.client.SMembers(ctx, idxKey).Result()
	if err != nil && err != redis.Nil {
		return fmt.Errorf("failed to list sessions for deletion: %w", err)
	}

	for _, id := range ids {
		ctx2, cancel2 := getContextWithTimeout(RedisOpTimeout)
		s.client.Del(ctx2, sessionKey(id))
		cancel2()
	}

	ctx3, cancel3 := getContextWithTimeout(RedisOpTimeout)
	defer cancel3()
	s.client.Del(ctx3, idxKey)

	ctx4, cancel4 := getContextWithTimeout(RedisOpTimeout)
	defer cancel4()
	s.client.Del(ctx4, sessionCurrentKey(userID, orgID))

	return nil
}

func (s *RedisSessionStore) GetCurrentSessionID(userID, orgID int64) (string, error) {
	ctx, cancel := getContextWithTimeout(RedisOpTimeout)
	defer cancel()
	id, err := s.client.Get(ctx, sessionCurrentKey(userID, orgID)).Result()
	if err == redis.Nil {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("failed to get current session: %w", err)
	}
	return id, nil
}

func (s *RedisSessionStore) SetCurrentSessionID(userID, orgID int64, sessionID string) error {
	rs, err := s.getSessionRaw(sessionID)
	if err != nil {
		return err
	}
	if rs.UserID != userID || rs.OrgID != orgID {
		return fmt.Errorf("session not found")
	}

	ctx, cancel := getContextWithTimeout(RedisOpTimeout)
	defer cancel()
	return s.client.Set(ctx, sessionCurrentKey(userID, orgID), sessionID, 0).Err()
}

func (s *RedisSessionStore) ClearCurrentSessionID(userID, orgID int64) error {
	ctx, cancel := getContextWithTimeout(RedisOpTimeout)
	defer cancel()
	return s.client.Del(ctx, sessionCurrentKey(userID, orgID)).Err()
}

func (s *RedisSessionStore) SetActiveRunID(sessionID string, userID, orgID int64, runID string) error {
	rs, err := s.getSessionRaw(sessionID)
	if err != nil {
		return err
	}
	if rs.UserID != userID || rs.OrgID != orgID {
		return fmt.Errorf("session not found")
	}

	session := fromRedis(rs)
	session.ActiveRunID = runID
	session.UpdatedAt = time.Now()
	return s.saveSession(session)
}

func (s *RedisSessionStore) ClearActiveRunID(sessionID string, userID, orgID int64) error {
	rs, err := s.getSessionRaw(sessionID)
	if err != nil {
		return err
	}
	if rs.UserID != userID || rs.OrgID != orgID {
		return fmt.Errorf("session not found")
	}

	session := fromRedis(rs)
	session.ActiveRunID = ""
	return s.saveSession(session)
}

func (s *RedisSessionStore) CleanupExpired() {
	// Redis TTL automatically handles expiration — no periodic cleanup needed.
}
