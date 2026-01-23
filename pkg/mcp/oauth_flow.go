package mcp

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	"github.com/redis/go-redis/v9"
)

// OAuthFlowManager handles OAuth 2.1 authorization flows for MCP servers
type OAuthFlowManager struct {
	tokenStore *TokenStore
	logger     log.Logger
	httpClient *http.Client

	// Track pending authorizations
	redisClient  *redis.Client
	pendingPrefix string // "oauth:pending:"
	mu           sync.RWMutex
}

// NewOAuthFlowManager creates a new OAuth flow manager
func NewOAuthFlowManager(tokenStore *TokenStore, redisClient *redis.Client, logger log.Logger) *OAuthFlowManager {
	return &OAuthFlowManager{
		tokenStore:    tokenStore,
		redisClient:   redisClient,
		logger:        logger,
		httpClient:    &http.Client{Timeout: 30 * time.Second},
		pendingPrefix: "oauth:pending:",
	}
}

// DiscoverMetadata discovers OAuth metadata from an MCP server
// Follows RFC 8414 (OAuth 2.0 Authorization Server Metadata) and RFC 9728 (Protected Resource Metadata)
func (m *OAuthFlowManager) DiscoverMetadata(ctx context.Context, serverURL string) (*OAuthMetadata, error) {
	// First, try to get protected resource metadata (RFC 9728)
	parsedURL, err := url.Parse(serverURL)
	if err != nil {
		return nil, fmt.Errorf("invalid server URL: %w", err)
	}

	// Try /.well-known/oauth-protected-resource first
	metadataURL := fmt.Sprintf("%s://%s/.well-known/oauth-protected-resource", parsedURL.Scheme, parsedURL.Host)

	resourceMeta, err := m.fetchProtectedResourceMetadata(ctx, metadataURL)
	if err != nil {
		m.logger.Debug("Protected resource metadata not found, trying authorization server metadata", "error", err)
	}

	// Get authorization server metadata URL
	var authServerURL string
	if resourceMeta != nil && len(resourceMeta.AuthorizationServers) > 0 {
		authServerURL = resourceMeta.AuthorizationServers[0]
	} else {
		// Fallback: try /.well-known/oauth-authorization-server
		authServerURL = fmt.Sprintf("%s://%s", parsedURL.Scheme, parsedURL.Host)
	}

	// Fetch authorization server metadata (RFC 8414)
	metadataEndpoint := fmt.Sprintf("%s/.well-known/oauth-authorization-server", authServerURL)

	req, err := http.NewRequestWithContext(ctx, "GET", metadataEndpoint, nil)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}

	resp, err := m.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetch metadata: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("metadata endpoint returned %d", resp.StatusCode)
	}

	var metadata OAuthMetadata
	if err := json.NewDecoder(resp.Body).Decode(&metadata); err != nil {
		return nil, fmt.Errorf("decode metadata: %w", err)
	}

	m.logger.Info("OAuth metadata discovered", "issuer", metadata.Issuer, "authEndpoint", metadata.AuthorizationEndpoint)
	return &metadata, nil
}

// fetchProtectedResourceMetadata fetches protected resource metadata (RFC 9728)
func (m *OAuthFlowManager) fetchProtectedResourceMetadata(ctx context.Context, metadataURL string) (*ProtectedResourceMetadata, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", metadataURL, nil)
	if err != nil {
		return nil, err
	}

	resp, err := m.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("status %d", resp.StatusCode)
	}

	var metadata ProtectedResourceMetadata
	if err := json.NewDecoder(resp.Body).Decode(&metadata); err != nil {
		return nil, err
	}

	return &metadata, nil
}

// RegisterClient dynamically registers a client with the authorization server (RFC 7591)
func (m *OAuthFlowManager) RegisterClient(ctx context.Context, registrationEndpoint, clientName, redirectURI string, scopes []string) (*ClientRegistrationResponse, error) {
	regReq := ClientRegistrationRequest{
		ClientName:    clientName,
		RedirectURIs:  []string{redirectURI},
		GrantTypes:    []string{"authorization_code", "refresh_token"},
		ResponseTypes: []string{"code"},
		Scope:         strings.Join(scopes, " "),
		TokenEndpointAuthMethod: "client_secret_basic",
	}

	body, err := json.Marshal(regReq)
	if err != nil {
		return nil, fmt.Errorf("marshal request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", registrationEndpoint, strings.NewReader(string(body)))
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := m.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("register client: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("registration failed with status %d: %s", resp.StatusCode, string(bodyBytes))
	}

	var regResp ClientRegistrationResponse
	if err := json.NewDecoder(resp.Body).Decode(&regResp); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}

	m.logger.Info("Client registered", "clientId", regResp.ClientID)
	return &regResp, nil
}

// GenerateAuthorizationURL creates an OAuth authorization URL with PKCE
func (m *OAuthFlowManager) GenerateAuthorizationURL(ctx context.Context, userID int64, serverID string, config *OAuth2Config, callbackURL string) (string, error) {
	// Generate PKCE parameters
	pkce, err := GeneratePKCE()
	if err != nil {
		return "", fmt.Errorf("generate PKCE: %w", err)
	}

	// Generate state for CSRF protection
	state, err := GenerateState()
	if err != nil {
		return "", fmt.Errorf("generate state: %w", err)
	}

	// Store pending authorization in Redis (10 minute TTL)
	pending := PendingAuth{
		ServerID:      serverID,
		UserID:        userID,
		State:         state,
		CodeVerifier:  pkce.CodeVerifier,
		CodeChallenge: pkce.CodeChallenge,
		CreatedAt:     time.Now(),
		ExpiresAt:     time.Now().Add(10 * time.Minute),
	}

	pendingData, err := json.Marshal(pending)
	if err != nil {
		return "", fmt.Errorf("marshal pending auth: %w", err)
	}

	key := m.pendingPrefix + state
	if err := m.redisClient.Set(ctx, key, pendingData, 10*time.Minute).Err(); err != nil {
		return "", fmt.Errorf("store pending auth: %w", err)
	}

	// Build authorization URL
	authURL, err := url.Parse(config.AuthorizationEndpoint)
	if err != nil {
		return "", fmt.Errorf("parse auth endpoint: %w", err)
	}

	params := url.Values{}
	params.Set("response_type", "code")
	params.Set("client_id", config.ClientID)
	params.Set("redirect_uri", callbackURL)
	params.Set("state", state)
	params.Set("code_challenge", pkce.CodeChallenge)
	params.Set("code_challenge_method", "S256")

	// Add resource parameter (RFC 8707)
	resource := config.Resource
	if resource == "" {
		// Default to server URL
		resource = config.Resource
	}
	if resource != "" {
		params.Set("resource", resource)
	}

	// Add scopes
	if len(config.Scopes) > 0 {
		params.Set("scope", strings.Join(config.Scopes, " "))
	}

	authURL.RawQuery = params.Encode()

	m.logger.Info("Authorization URL generated", "server", serverID, "userId", userID)
	return authURL.String(), nil
}

// ExchangeCodeForToken exchanges an authorization code for tokens using PKCE
func (m *OAuthFlowManager) ExchangeCodeForToken(ctx context.Context, code, state string, config *OAuth2Config, callbackURL string) (*StoredToken, error) {
	// Retrieve pending authorization
	key := m.pendingPrefix + state
	pendingData, err := m.redisClient.Get(ctx, key).Bytes()
	if err == redis.Nil {
		return nil, fmt.Errorf("invalid or expired state parameter")
	}
	if err != nil {
		return nil, fmt.Errorf("retrieve pending auth: %w", err)
	}

	var pending PendingAuth
	if err := json.Unmarshal(pendingData, &pending); err != nil {
		return nil, fmt.Errorf("unmarshal pending auth: %w", err)
	}

	// Delete pending authorization (one-time use)
	m.redisClient.Del(ctx, key)

	// Exchange code for token
	params := url.Values{}
	params.Set("grant_type", "authorization_code")
	params.Set("code", code)
	params.Set("redirect_uri", callbackURL)
	params.Set("client_id", config.ClientID)
	params.Set("code_verifier", pending.CodeVerifier) // PKCE verification

	if config.ClientSecret != "" {
		params.Set("client_secret", config.ClientSecret)
	}

	// Add resource parameter
	if config.Resource != "" {
		params.Set("resource", config.Resource)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", config.TokenEndpoint, strings.NewReader(params.Encode()))
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := m.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("token exchange: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		var tokenErr TokenErrorResponse
		if json.Unmarshal(bodyBytes, &tokenErr) == nil {
			return nil, fmt.Errorf("token error: %s - %s", tokenErr.Error, tokenErr.ErrorDescription)
		}
		return nil, fmt.Errorf("token exchange failed with status %d: %s", resp.StatusCode, string(bodyBytes))
	}

	var tokenResp TokenResponse
	if err := json.NewDecoder(resp.Body).Decode(&tokenResp); err != nil {
		return nil, fmt.Errorf("decode token response: %w", err)
	}

	// Calculate expiration
	expiresAt := time.Now().Add(time.Duration(tokenResp.ExpiresIn) * time.Second)
	if tokenResp.ExpiresIn == 0 {
		expiresAt = time.Now().Add(1 * time.Hour) // Default 1 hour
	}

	token := &StoredToken{
		ServerID:     pending.ServerID,
		UserID:       pending.UserID,
		AccessToken:  tokenResp.AccessToken,
		RefreshToken: tokenResp.RefreshToken,
		TokenType:    tokenResp.TokenType,
		ExpiresAt:    expiresAt,
		Scopes:       strings.Split(tokenResp.Scope, " "),
		Audience:     config.Resource,
	}

	// Save token to Redis (encrypted)
	if err := m.tokenStore.Save(ctx, token); err != nil {
		return nil, fmt.Errorf("save token: %w", err)
	}

	m.logger.Info("Token exchanged and saved", "server", pending.ServerID, "userId", pending.UserID)
	return token, nil
}

// RefreshToken refreshes an expired token
func (m *OAuthFlowManager) RefreshToken(ctx context.Context, userID int64, serverID string, config *OAuth2Config) (*StoredToken, error) {
	// Load existing token
	token, err := m.tokenStore.Load(ctx, userID, serverID)
	if err != nil {
		return nil, fmt.Errorf("load token: %w", err)
	}

	if token.RefreshToken == "" {
		return nil, fmt.Errorf("no refresh token available")
	}

	// Request new token
	params := url.Values{}
	params.Set("grant_type", "refresh_token")
	params.Set("refresh_token", token.RefreshToken)
	params.Set("client_id", config.ClientID)

	if config.ClientSecret != "" {
		params.Set("client_secret", config.ClientSecret)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", config.TokenEndpoint, strings.NewReader(params.Encode()))
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := m.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("token refresh: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("refresh failed with status %d: %s", resp.StatusCode, string(bodyBytes))
	}

	var tokenResp TokenResponse
	if err := json.NewDecoder(resp.Body).Decode(&tokenResp); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}

	// Update token
	expiresAt := time.Now().Add(time.Duration(tokenResp.ExpiresIn) * time.Second)
	token.AccessToken = tokenResp.AccessToken
	if tokenResp.RefreshToken != "" {
		token.RefreshToken = tokenResp.RefreshToken
	}
	token.ExpiresAt = expiresAt

	// Save updated token
	if err := m.tokenStore.Save(ctx, token); err != nil {
		return nil, fmt.Errorf("save token: %w", err)
	}

	m.logger.Info("Token refreshed", "server", serverID, "userId", userID)
	return token, nil
}

// GetValidToken retrieves a token and refreshes it if expired
func (m *OAuthFlowManager) GetValidToken(ctx context.Context, userID int64, serverID string, config *OAuth2Config) (*StoredToken, error) {
	token, err := m.tokenStore.Load(ctx, userID, serverID)
	if err != nil {
		return nil, fmt.Errorf("load token: %w", err)
	}

	// Check if token is expired or expiring soon (within 5 minutes)
	if time.Until(token.ExpiresAt) < 5*time.Minute {
		m.logger.Info("Token expiring soon, refreshing", "server", serverID, "userId", userID)
		token, err = m.RefreshToken(ctx, userID, serverID, config)
		if err != nil {
			return nil, fmt.Errorf("refresh token: %w", err)
		}
	}

	return token, nil
}

// RevokeToken deletes a token from storage
func (m *OAuthFlowManager) RevokeToken(ctx context.Context, userID int64, serverID string) error {
	return m.tokenStore.Delete(ctx, userID, serverID)
}
