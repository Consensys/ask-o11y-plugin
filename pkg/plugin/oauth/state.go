package oauth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	"github.com/redis/go-redis/v9"
)

// StateTTL is how long a pending authorization-code flow is kept alive. The
// OAuth spec recommends short lifetimes because the parameter is exchanged
// through a browser redirect and should be treated as one-shot.
const StateTTL = 5 * time.Minute

// StateEntry stores everything we need to complete the authorization-code
// exchange in the /callback handler.
type StateEntry struct {
	ServerID     string    `json:"serverID"`
	UserID       int64     `json:"userID"`
	CodeVerifier string    `json:"codeVerifier,omitempty"`
	ReturnURL    string    `json:"returnURL,omitempty"`
	CreatedAt    time.Time `json:"createdAt"`
}

// StateStore persists pending-flow state keyed by the opaque `state` param we
// pass to the authorization server.
type StateStore interface {
	Put(ctx context.Context, state string, entry StateEntry) error
	PopAndGet(ctx context.Context, state string) (StateEntry, error)
}

// InMemoryStateStore is process-local and sufficient for single-replica or
// dev environments. Entries are pruned lazily on access.
type InMemoryStateStore struct {
	mu      sync.Mutex
	entries map[string]StateEntry
}

func NewInMemoryStateStore() *InMemoryStateStore {
	return &InMemoryStateStore{entries: map[string]StateEntry{}}
}

func (s *InMemoryStateStore) Put(_ context.Context, state string, entry StateEntry) error {
	entry.CreatedAt = time.Now()
	s.mu.Lock()
	defer s.mu.Unlock()
	s.entries[state] = entry
	return nil
}

func (s *InMemoryStateStore) PopAndGet(_ context.Context, state string) (StateEntry, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	e, ok := s.entries[state]
	if !ok {
		return StateEntry{}, ErrStateInvalid
	}
	delete(s.entries, state)
	if time.Since(e.CreatedAt) > StateTTL {
		return StateEntry{}, ErrStateInvalid
	}
	return e, nil
}

// RedisStateStore persists pending state in Redis with a short TTL.
type RedisStateStore struct {
	client *redis.Client
	logger log.Logger
	ctx    context.Context
}

func NewRedisStateStore(ctx context.Context, client *redis.Client, logger log.Logger) *RedisStateStore {
	return &RedisStateStore{client: client, logger: logger, ctx: ctx}
}

func (s *RedisStateStore) Put(ctx context.Context, state string, entry StateEntry) error {
	entry.CreatedAt = time.Now()
	raw, err := json.Marshal(entry)
	if err != nil {
		return fmt.Errorf("encode state: %w", err)
	}
	if err := s.client.Set(ctx, stateRedisKey(state), raw, StateTTL).Err(); err != nil {
		return fmt.Errorf("redis set state: %w", err)
	}
	return nil
}

func (s *RedisStateStore) PopAndGet(ctx context.Context, state string) (StateEntry, error) {
	// GETDEL atomically reads and removes the key, preventing replay.
	raw, err := s.client.GetDel(ctx, stateRedisKey(state)).Result()
	if errors.Is(err, redis.Nil) {
		return StateEntry{}, ErrStateInvalid
	}
	if err != nil {
		return StateEntry{}, fmt.Errorf("redis getdel state: %w", err)
	}
	var e StateEntry
	if err := json.Unmarshal([]byte(raw), &e); err != nil {
		return StateEntry{}, fmt.Errorf("decode state: %w", err)
	}
	return e, nil
}

// NewState returns a cryptographically random opaque string suitable for use
// as the OAuth `state` parameter. Callers persist it via the StateStore.
func NewState() (string, error) {
	var buf [32]byte
	if _, err := rand.Read(buf[:]); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf[:]), nil
}

// NewPKCEPair generates an RFC 7636 code_verifier and its S256 challenge.
func NewPKCEPair() (verifier, challenge string, err error) {
	var buf [64]byte
	if _, err = rand.Read(buf[:]); err != nil {
		return "", "", err
	}
	verifier = base64.RawURLEncoding.EncodeToString(buf[:])
	sum := sha256.Sum256([]byte(verifier))
	challenge = base64.RawURLEncoding.EncodeToString(sum[:])
	return verifier, challenge, nil
}
