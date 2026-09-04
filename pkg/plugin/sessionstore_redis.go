package plugin

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	"github.com/redis/go-redis/v9"
)

func sessionKey(id string) string { return fmt.Sprintf("session:%s", id) }
func sessionUserIdxKey(userID, orgID int64) string {
	return fmt.Sprintf("usersessions:%d:%d", userID, orgID)
}
func sessionCurrentKey(userID, orgID int64) string {
	return fmt.Sprintf("usersessions:%d:%d:current", userID, orgID)
}

// sessionStatsKey is a separate hash from the main session blob so
// IncrementStats can HINCRBY atomically instead of racing with the
// read-modify-write cycle every other session mutator uses on the blob.
func sessionStatsKey(id string) string { return fmt.Sprintf("session:%s:stats", id) }

// redisSession is the on-wire format stored in Redis (includes owner fields).
// Usage-stats fields live in a separate hash (sessionStatsKey) so they never
// round-trip through this struct's read-modify-write cycle — see IncrementStats.
type redisSession struct {
	ID           string           `json:"id"`
	Title        string           `json:"title"`
	Messages     []SessionMessage `json:"messages"`
	Summary      string           `json:"summary,omitempty"`
	CreatedAt    time.Time        `json:"createdAt"`
	UpdatedAt    time.Time        `json:"updatedAt"`
	MessageCount int              `json:"messageCount"`
	ActiveRunID  string           `json:"activeRunId,omitempty"`
	Model        string           `json:"model,omitempty"`
	UserID       int64            `json:"userId"`
	OrgID        int64            `json:"orgId"`
}

func toRedis(s *ChatSession) *redisSession {
	return &redisSession{
		ID: s.ID, Title: s.Title, Messages: s.Messages,
		Summary: s.Summary, CreatedAt: s.CreatedAt, UpdatedAt: s.UpdatedAt,
		MessageCount: s.MessageCount, ActiveRunID: s.ActiveRunID, Model: s.Model,
		UserID: s.UserID, OrgID: s.OrgID,
	}
}

func fromRedis(rs *redisSession) *ChatSession {
	return &ChatSession{
		ID: rs.ID, Title: rs.Title, Messages: rs.Messages,
		Summary: rs.Summary, CreatedAt: rs.CreatedAt, UpdatedAt: rs.UpdatedAt,
		MessageCount: rs.MessageCount, ActiveRunID: rs.ActiveRunID, Model: rs.Model,
		UserID: rs.UserID, OrgID: rs.OrgID,
	}
}

type RedisSessionStore struct {
	client     *redis.Client
	logger     log.Logger
	ctx        context.Context
	sessionTTL time.Duration
}

func NewRedisSessionStore(ctx context.Context, client *redis.Client, logger log.Logger, sessionTTL time.Duration) *RedisSessionStore {
	return &RedisSessionStore{client: client, logger: logger, ctx: ctx, sessionTTL: sessionTTL}
}

func (s *RedisSessionStore) CreateSession(userID, orgID int64, title string, messages []SessionMessage) (*ChatSession, error) {
	idxKey := sessionUserIdxKey(userID, orgID)

	// Session blobs now expire via TTL (see sessionTTL), which is the sole
	// retention mechanism — there is no session-count cap. Still prune dead
	// IDs from the index here so it doesn't grow unbounded between reads
	// (Redis Sets have no per-member TTL; ListSessions self-heals lazily,
	// but active writers like NOC automation may rarely call it).
	if _, err := s.pruneStaleIndexEntries(idxKey); err != nil {
		s.logger.Warn("Failed to prune stale session index entries", "error", err)
	}

	id, err := generateShareID()
	if err != nil {
		return nil, fmt.Errorf("failed to generate session ID: %w", err)
	}

	if title == "" {
		title = generateSessionTitle(messages)
	}

	now := time.Now()
	session := &ChatSession{
		ID: id, Title: title, Messages: messages,
		CreatedAt: now, UpdatedAt: now, MessageCount: len(messages),
		UserID: userID, OrgID: orgID,
	}

	data, err := json.Marshal(toRedis(session))
	if err != nil {
		return nil, fmt.Errorf("failed to marshal session: %w", err)
	}

	ctx2, cancel2 := redisContext(s.ctx, RedisOpTimeout)
	defer cancel2()
	if err := s.client.Set(ctx2, sessionKey(id), data, s.sessionTTL).Err(); err != nil {
		return nil, fmt.Errorf("failed to store session: %w", err)
	}

	ctx3, cancel3 := redisContext(s.ctx, RedisOpTimeout)
	defer cancel3()
	if err := s.client.SAdd(ctx3, idxKey, id).Err(); err != nil {
		delCtx, delCancel := redisContext(s.ctx, RedisOpTimeout)
		defer delCancel()
		s.client.Del(delCtx, sessionKey(id))
		return nil, fmt.Errorf("failed to index session: %w", err)
	}

	return session, nil
}

// pruneStaleIndexEntries removes session IDs from the user index whose
// backing session blob has already expired via TTL, and returns the count of
// entries that are still live. Without this, the index would only ever grow
// (Redis Sets have no per-member TTL).
func (s *RedisSessionStore) pruneStaleIndexEntries(idxKey string) (int64, error) {
	ctx, cancel := redisContext(s.ctx, RedisBulkOpTimeout)
	defer cancel()
	ids, err := s.client.SMembers(ctx, idxKey).Result()
	if err != nil && err != redis.Nil {
		return 0, err
	}
	if len(ids) == 0 {
		return 0, nil
	}

	ctx2, cancel2 := redisContext(s.ctx, RedisBulkOpTimeout)
	defer cancel2()
	pipe := s.client.Pipeline()
	cmds := make([]*redis.IntCmd, len(ids))
	for i, id := range ids {
		cmds[i] = pipe.Exists(ctx2, sessionKey(id))
	}
	if _, err := pipe.Exec(ctx2); err != nil && err != redis.Nil {
		return 0, err
	}

	var stale []string
	var live int64
	for i, cmd := range cmds {
		if cmd.Val() > 0 {
			live++
		} else {
			stale = append(stale, ids[i])
		}
	}
	if len(stale) > 0 {
		ctx3, cancel3 := redisContext(s.ctx, RedisOpTimeout)
		defer cancel3()
		if err := s.client.SRem(ctx3, idxKey, stale).Err(); err != nil {
			s.logger.Warn("Failed to remove stale session index entries", "error", err)
		}
	}
	return live, nil
}

func (s *RedisSessionStore) getSessionRaw(sessionID string) (*redisSession, error) {
	ctx, cancel := redisContext(s.ctx, RedisOpTimeout)
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
	ctx, cancel := redisContext(s.ctx, RedisOpTimeout)
	defer cancel()
	return s.client.Set(ctx, sessionKey(session.ID), data, s.sessionTTL).Err()
}

func (s *RedisSessionStore) GetSession(sessionID string, userID, orgID int64) (*ChatSession, error) {
	rs, err := s.getSessionRaw(sessionID)
	if err != nil {
		return nil, err
	}
	if rs.UserID != userID || rs.OrgID != orgID {
		return nil, fmt.Errorf("session not found")
	}
	session := fromRedis(rs)
	if err := s.loadStats(session); err != nil {
		s.logger.Warn("Failed to load session stats", "error", err, "sessionId", sessionID)
	}
	return session, nil
}

// loadStats fills in session's usage-stats fields from the stats hash.
// Missing/absent fields default to zero (HGetAll returns an empty map for a
// hash that was never incremented), so this is safe for sessions with no runs.
func (s *RedisSessionStore) loadStats(session *ChatSession) error {
	ctx, cancel := redisContext(s.ctx, RedisOpTimeout)
	defer cancel()
	fields, err := s.client.HGetAll(ctx, sessionStatsKey(session.ID)).Result()
	if err != nil && err != redis.Nil {
		return err
	}
	session.RunCount = parseStatsField(fields["runCount"])
	session.TotalIterations = parseStatsField(fields["totalIterations"])
	session.ToolCallCount = parseStatsField(fields["toolCallCount"])
	session.PromptTokens = int64(parseStatsField(fields["promptTokens"]))
	session.CompletionTokens = int64(parseStatsField(fields["completionTokens"]))
	session.TotalTokens = int64(parseStatsField(fields["totalTokens"]))
	return nil
}

func parseStatsField(v string) int {
	n, _ := strconv.Atoi(v)
	return n
}

func (s *RedisSessionStore) ListSessions(userID, orgID int64) ([]SessionMetadata, error) {
	idxKey := sessionUserIdxKey(userID, orgID)

	ctx, cancel := redisContext(s.ctx, RedisBulkOpTimeout)
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

	ctx2, cancel2 := redisContext(s.ctx, RedisBulkOpTimeout)
	defer cancel2()
	values, err := s.client.MGet(ctx2, keys...).Result()
	if err != nil {
		return nil, fmt.Errorf("failed to get sessions: %w", err)
	}

	result := make([]SessionMetadata, 0, len(values))
	for i, val := range values {
		if val == nil {
			// Stale index entry — remove it
			ctx3, cancel3 := redisContext(s.ctx, RedisOpTimeout)
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
		result = append(result, SessionMetadata{
			ID: rs.ID, Title: rs.Title, CreatedAt: rs.CreatedAt,
			UpdatedAt: rs.UpdatedAt, MessageCount: rs.MessageCount,
			ActiveRunID: rs.ActiveRunID,
			Model:       rs.Model,
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
	if update.Model != nil {
		session.Model = *update.Model
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

	ctx, cancel := redisContext(s.ctx, RedisOpTimeout)
	defer cancel()
	s.client.Del(ctx, sessionKey(sessionID), sessionStatsKey(sessionID))

	ctx2, cancel2 := redisContext(s.ctx, RedisOpTimeout)
	defer cancel2()
	s.client.SRem(ctx2, sessionUserIdxKey(userID, orgID), sessionID)

	curKey := sessionCurrentKey(userID, orgID)
	ctx3, cancel3 := redisContext(s.ctx, RedisOpTimeout)
	defer cancel3()
	cur, err := s.client.Get(ctx3, curKey).Result()
	if err == nil && cur == sessionID {
		ctx4, cancel4 := redisContext(s.ctx, RedisOpTimeout)
		defer cancel4()
		s.client.Del(ctx4, curKey)
	}

	return nil
}

func (s *RedisSessionStore) DeleteAllSessions(userID, orgID int64) error {
	idxKey := sessionUserIdxKey(userID, orgID)

	ctx, cancel := redisContext(s.ctx, RedisBulkOpTimeout)
	defer cancel()
	ids, err := s.client.SMembers(ctx, idxKey).Result()
	if err != nil && err != redis.Nil {
		return fmt.Errorf("failed to list sessions for deletion: %w", err)
	}

	for _, id := range ids {
		ctx2, cancel2 := redisContext(s.ctx, RedisOpTimeout)
		s.client.Del(ctx2, sessionKey(id), sessionStatsKey(id))
		cancel2()
	}

	ctx3, cancel3 := redisContext(s.ctx, RedisOpTimeout)
	defer cancel3()
	s.client.Del(ctx3, idxKey)

	ctx4, cancel4 := redisContext(s.ctx, RedisOpTimeout)
	defer cancel4()
	s.client.Del(ctx4, sessionCurrentKey(userID, orgID))

	return nil
}

func (s *RedisSessionStore) GetCurrentSessionID(userID, orgID int64) (string, error) {
	ctx, cancel := redisContext(s.ctx, RedisOpTimeout)
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

	ctx, cancel := redisContext(s.ctx, RedisOpTimeout)
	defer cancel()
	return s.client.Set(ctx, sessionCurrentKey(userID, orgID), sessionID, 0).Err()
}

func (s *RedisSessionStore) ClearCurrentSessionID(userID, orgID int64) error {
	ctx, cancel := redisContext(s.ctx, RedisOpTimeout)
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

// IncrementStats applies delta via HINCRBY on a hash separate from the main
// session blob, so it can't race with the read-modify-write cycle every other
// mutator (AppendMessages, SetActiveRunID, ...) uses — concurrent runs on the
// same session (e.g. two tabs, or an automation retriggering a run) can't
// silently drop a delta the way a read-modify-write on the blob would.
func (s *RedisSessionStore) IncrementStats(sessionID string, userID, orgID int64, delta SessionStatsDelta) error {
	rs, err := s.getSessionRaw(sessionID)
	if err != nil {
		return err
	}
	if rs.UserID != userID || rs.OrgID != orgID {
		return fmt.Errorf("session not found")
	}

	ctx, cancel := redisContext(s.ctx, RedisOpTimeout)
	defer cancel()
	statsKey := sessionStatsKey(sessionID)
	pipe := s.client.Pipeline()
	pipe.HIncrBy(ctx, statsKey, "runCount", int64(delta.RunCount))
	pipe.HIncrBy(ctx, statsKey, "totalIterations", int64(delta.TotalIterations))
	pipe.HIncrBy(ctx, statsKey, "toolCallCount", int64(delta.ToolCallCount))
	pipe.HIncrBy(ctx, statsKey, "promptTokens", delta.PromptTokens)
	pipe.HIncrBy(ctx, statsKey, "completionTokens", delta.CompletionTokens)
	pipe.HIncrBy(ctx, statsKey, "totalTokens", delta.TotalTokens)
	pipe.Expire(ctx, statsKey, s.sessionTTL)
	_, err = pipe.Exec(ctx)
	return err
}

func (s *RedisSessionStore) CleanupOld() {
	// Sessions expire natively via the TTL set on every write (see
	// saveSession) — no periodic sweep needed.
}
