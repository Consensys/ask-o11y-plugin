package oauth

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"consensys-asko11y-app/pkg/mcp"
)

// tokenResponse matches the OAuth2 token-endpoint response body.
type tokenResponse struct {
	AccessToken  string `json:"access_token"`
	TokenType    string `json:"token_type,omitempty"`
	ExpiresIn    int64  `json:"expires_in,omitempty"`
	RefreshToken string `json:"refresh_token,omitempty"`
	Scope        string `json:"scope,omitempty"`
}

// exchangeCode trades an authorization code for a token pair.
func exchangeCode(ctx context.Context, httpClient *http.Client, cfg *mcp.OAuthConfig, code, codeVerifier, redirectURI string) (Token, error) {
	form := url.Values{}
	form.Set("grant_type", "authorization_code")
	form.Set("code", code)
	form.Set("client_id", cfg.ClientID)
	form.Set("redirect_uri", redirectURI)
	if cfg.PKCE && codeVerifier != "" {
		form.Set("code_verifier", codeVerifier)
	}
	return postToken(ctx, httpClient, cfg, form)
}

// refreshToken trades a refresh token for a fresh access token. The server
// may or may not rotate the refresh token; we persist whatever we get back.
func refreshToken(ctx context.Context, httpClient *http.Client, cfg *mcp.OAuthConfig, refresh string) (Token, error) {
	form := url.Values{}
	form.Set("grant_type", "refresh_token")
	form.Set("refresh_token", refresh)
	form.Set("client_id", cfg.ClientID)
	return postToken(ctx, httpClient, cfg, form)
}

func postToken(ctx context.Context, httpClient *http.Client, cfg *mcp.OAuthConfig, form url.Values) (Token, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, cfg.TokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return Token{}, fmt.Errorf("build token request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	if cfg.ClientSecret != "" {
		req.SetBasicAuth(url.QueryEscape(cfg.ClientID), url.QueryEscape(cfg.ClientSecret))
	}

	resp, err := httpClient.Do(req)
	if err != nil {
		return Token{}, fmt.Errorf("token endpoint: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		return Token{}, fmt.Errorf("token endpoint returned %s: %s", resp.Status, strings.TrimSpace(string(body)))
	}

	var parsed tokenResponse
	if err := json.Unmarshal(body, &parsed); err != nil {
		return Token{}, fmt.Errorf("decode token response: %w", err)
	}
	if parsed.AccessToken == "" {
		return Token{}, fmt.Errorf("token endpoint returned empty access_token")
	}

	expiresAt := time.Now().Add(time.Duration(parsed.ExpiresIn) * time.Second)
	if parsed.ExpiresIn == 0 {
		// Unknown expiry: default to a short window so we refresh conservatively.
		expiresAt = time.Now().Add(15 * time.Minute)
	}
	return Token{
		AccessToken:  parsed.AccessToken,
		RefreshToken: parsed.RefreshToken,
		TokenType:    parsed.TokenType,
		ExpiresAt:    expiresAt,
	}, nil
}

// refresh uses the configured client to run refreshToken. It's a method on
// Manager so callers don't have to own the HTTP client.
func (m *Manager) refresh(ctx context.Context, serverID string, tok Token) (Token, error) {
	cfg := m.ConfigFor(serverID)
	if cfg == nil {
		return Token{}, fmt.Errorf("no oauth config for server %q", serverID)
	}
	if tok.RefreshToken == "" {
		return Token{}, fmt.Errorf("no refresh token available")
	}
	return refreshToken(ctx, http.DefaultClient, cfg, tok.RefreshToken)
}
