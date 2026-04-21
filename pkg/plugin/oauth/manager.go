package oauth

import (
	"context"
	"errors"
	"fmt"
	"sync"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"

	"consensys-asko11y-app/pkg/mcp"
)

// Manager wires together the OAuth HTTP handlers, stores, and per-server
// configuration. A single Manager is created in NewPlugin and shared across
// the plugin's lifetime.
type Manager struct {
	tokens  UserTokenStore
	state   StateStore
	logger  log.Logger
	configs map[string]*mcp.OAuthConfig // keyed by server ID
	mu      sync.RWMutex
}

// NewManager returns a Manager seeded with the OAuth configs declared on the
// given server list. Servers without an OAuth block are ignored.
func NewManager(tokens UserTokenStore, state StateStore, logger log.Logger, servers []mcp.ServerConfig) *Manager {
	m := &Manager{
		tokens:  tokens,
		state:   state,
		logger:  logger,
		configs: map[string]*mcp.OAuthConfig{},
	}
	for _, s := range servers {
		if s.OAuth != nil {
			m.configs[s.ID] = s.OAuth
		}
	}
	return m
}

// ConfigFor returns the OAuth config for the given server, or nil if the
// server does not use OAuth.
func (m *Manager) ConfigFor(serverID string) *mcp.OAuthConfig {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.configs[serverID]
}

// RegisterConfig inserts an OAuth config for a server added at runtime (e.g.
// through the AppConfig UI). Safe to call on an already-registered server.
func (m *Manager) RegisterConfig(serverID string, cfg *mcp.OAuthConfig) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.configs[serverID] = cfg
}

// UnregisterConfig removes the OAuth config for a server. Called when a
// server is removed from the runtime registry.
func (m *Manager) UnregisterConfig(serverID string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.configs, serverID)
}

// ServerIDs returns the set of server IDs known to this manager.
func (m *Manager) ServerIDs() []string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := make([]string, 0, len(m.configs))
	for id := range m.configs {
		out = append(out, id)
	}
	return out
}

// Tokens exposes the underlying token store for the round tripper and tests.
func (m *Manager) Tokens() UserTokenStore { return m.tokens }

// BearerFor implements mcp.PerUserTokenProvider. Reads the user ID from the
// context, resolves the current token (refreshing if needed), and returns
// the bearer value to inject in the Authorization header.
func (m *Manager) BearerFor(ctx context.Context, serverID string) (string, error) {
	userID, ok := mcp.UserIDFromContext(ctx)
	if !ok {
		return "", mcp.ErrPerUserTokenUnavailable
	}
	tok, err := m.TokenFor(ctx, serverID, userID)
	if errors.Is(err, ErrOAuthNotConnected) {
		return "", mcp.ErrPerUserTokenUnavailable
	}
	if err != nil {
		return "", err
	}
	return tok.AccessToken, nil
}

// TokenFor returns the stored token for a user on a server, refreshing it
// when close to expiry. Returns ErrOAuthNotConnected if no token is stored.
func (m *Manager) TokenFor(ctx context.Context, serverID string, userID int64) (Token, error) {
	tok, ok, err := m.tokens.Get(ctx, serverID, userID)
	if err != nil {
		return Token{}, fmt.Errorf("token lookup: %w", err)
	}
	if !ok {
		return Token{}, ErrOAuthNotConnected
	}
	if !tok.NeedsRefresh() {
		return tok, nil
	}
	refreshed, err := m.refresh(ctx, serverID, tok)
	if err != nil {
		if tok.Expired() {
			return Token{}, err
		}
		// Refresh failed but token is still usable for a little while; log
		// and return the stale-but-valid token so the in-flight request
		// succeeds.
		m.logger.Warn("OAuth refresh failed, returning current token", "server", serverID, "err", err)
		return tok, nil
	}
	if err := m.tokens.Put(ctx, serverID, userID, refreshed); err != nil {
		m.logger.Warn("persist refreshed token", "server", serverID, "err", err)
	}
	return refreshed, nil
}
