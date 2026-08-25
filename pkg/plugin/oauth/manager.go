package oauth

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"sync"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"

	"consensys-asko11y-app/pkg/mcp"
)

// Manager wires together the OAuth HTTP handlers, stores, and per-server
// configuration. A single Manager is created in NewPlugin and shared across
// the plugin's lifetime. It implements mcp.PerUserTokenProvider.
type Manager struct {
	tokens     UserTokenStore
	state      StateStore
	httpClient *http.Client
	logger     log.Logger
	configs    map[string]*mcp.OAuthConfig // keyed by server ID
	mu         sync.RWMutex
	// refreshMu serializes token refresh per (serverID, userID). Providers
	// commonly rotate the refresh token on use; two concurrent refreshes
	// would let the loser persist a token derived from a consumed refresh
	// token and lock the user out until they reconnect.
	refreshMu sync.Map // string -> *sync.Mutex
}

// NewManager returns a Manager seeded with the OAuth configs declared on the
// given server list. Servers without an OAuth block are ignored. httpClient
// is used for token exchange/refresh and must come from the Grafana SDK's
// httpclient.New.
func NewManager(tokens UserTokenStore, state StateStore, httpClient *http.Client, logger log.Logger, servers []mcp.ServerConfig) *Manager {
	m := &Manager{
		tokens:     tokens,
		state:      state,
		httpClient: httpClient,
		logger:     logger,
		configs:    map[string]*mcp.OAuthConfig{},
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

// RegisterConfig inserts an OAuth config for a server added at runtime
// through the AppConfig UI. Safe to call on an already-registered server.
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

// Tokens exposes the underlying token store for status reporting and tests.
func (m *Manager) Tokens() UserTokenStore { return m.tokens }

// BearerFor implements mcp.PerUserTokenProvider. It reads the user ID from
// the context, resolves the current token (refreshing if needed), and
// returns the bearer value to inject in the Authorization header.
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
// when close to expiry. Returns ErrOAuthNotConnected when no token is stored.
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

	muAny, _ := m.refreshMu.LoadOrStore(memTokenKey(serverID, userID), &sync.Mutex{})
	mu := muAny.(*sync.Mutex)
	mu.Lock()
	defer mu.Unlock()

	// Re-read under the lock: a concurrent call may have refreshed already.
	tok, ok, err = m.tokens.Get(ctx, serverID, userID)
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
		// Refresh failed but the token is still valid for a little while;
		// return it so the in-flight request succeeds and retry next call.
		m.logger.Warn("OAuth refresh failed, returning current token", "server", serverID, "err", err)
		return tok, nil
	}
	if err := m.tokens.Put(ctx, serverID, userID, refreshed); err != nil {
		m.logger.Warn("persist refreshed token", "server", serverID, "err", err)
	}
	return refreshed, nil
}

func (m *Manager) refresh(ctx context.Context, serverID string, tok Token) (Token, error) {
	cfg := m.ConfigFor(serverID)
	if cfg == nil {
		return Token{}, fmt.Errorf("no oauth config for server %q", serverID)
	}
	if tok.RefreshToken == "" {
		return Token{}, fmt.Errorf("no refresh token available")
	}
	refreshed, err := refreshToken(ctx, m.httpClient, cfg, tok.RefreshToken)
	if err != nil {
		return Token{}, err
	}
	// Providers that don't rotate refresh tokens omit them from the refresh
	// response; keep the current one so the next refresh still works.
	if refreshed.RefreshToken == "" {
		refreshed.RefreshToken = tok.RefreshToken
	}
	return refreshed, nil
}
