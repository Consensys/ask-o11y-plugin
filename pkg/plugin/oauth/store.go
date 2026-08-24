package oauth

import (
	"context"
	"strings"
	"sync"
	"time"
)

// Token is a stored OAuth2 access/refresh token pair for a single
// (serverID, userID) tuple.
type Token struct {
	AccessToken  string    `json:"accessToken"`
	RefreshToken string    `json:"refreshToken,omitempty"`
	TokenType    string    `json:"tokenType,omitempty"`
	ExpiresAt    time.Time `json:"expiresAt"`
}

// Expired reports whether the token is past its expiry (with a small clock
// skew allowance) at the current instant.
func (t Token) Expired() bool {
	return !t.ExpiresAt.IsZero() && time.Now().After(t.ExpiresAt.Add(-5*time.Second))
}

// NeedsRefresh reports whether the token is close enough to expiry that we
// should refresh it proactively before the next outbound call.
func (t Token) NeedsRefresh() bool {
	return !t.ExpiresAt.IsZero() && time.Until(t.ExpiresAt) < 60*time.Second
}

// UserTokenStore persists per-user OAuth tokens scoped by MCP server.
type UserTokenStore interface {
	Get(ctx context.Context, serverID string, userID int64) (Token, bool, error)
	Put(ctx context.Context, serverID string, userID int64, token Token) error
	Delete(ctx context.Context, serverID string, userID int64) error
	// DeleteServer removes every user's token for a server. Called when the
	// server is deprovisioned so stale credentials can't outlive it.
	DeleteServer(ctx context.Context, serverID string) error
}

// InMemoryUserTokenStore is a process-local token store used when Redis is
// unavailable. Tokens are lost on plugin restart — the same trade-off the
// in-memory session store accepts.
type InMemoryUserTokenStore struct {
	mu     sync.RWMutex
	tokens map[string]Token
}

func NewInMemoryUserTokenStore() *InMemoryUserTokenStore {
	return &InMemoryUserTokenStore{tokens: map[string]Token{}}
}

func (s *InMemoryUserTokenStore) Get(_ context.Context, serverID string, userID int64) (Token, bool, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	t, ok := s.tokens[memTokenKey(serverID, userID)]
	return t, ok, nil
}

func (s *InMemoryUserTokenStore) Put(_ context.Context, serverID string, userID int64, token Token) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.tokens[memTokenKey(serverID, userID)] = token
	return nil
}

func (s *InMemoryUserTokenStore) Delete(_ context.Context, serverID string, userID int64) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.tokens, memTokenKey(serverID, userID))
	return nil
}

func (s *InMemoryUserTokenStore) DeleteServer(_ context.Context, serverID string) error {
	prefix := serverIDEscape(serverID) + "|"
	s.mu.Lock()
	defer s.mu.Unlock()
	for k := range s.tokens {
		if strings.HasPrefix(k, prefix) {
			delete(s.tokens, k)
		}
	}
	return nil
}

func memTokenKey(serverID string, userID int64) string {
	return serverIDEscape(serverID) + "|" + userIDString(userID)
}
