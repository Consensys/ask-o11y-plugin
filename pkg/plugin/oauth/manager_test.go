package oauth

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"

	"consensys-asko11y-app/pkg/mcp"
)

// TestRefreshPreservesRefreshToken guards against wiping the stored refresh
// token when the provider's refresh response omits one (non-rotating
// providers reuse the original refresh token).
func TestRefreshPreservesRefreshToken(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/token", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		// No refresh_token in the response.
		_, _ = w.Write([]byte(`{"access_token":"AT2","expires_in":3600,"token_type":"Bearer"}`))
	})
	ts := httptest.NewServer(mux)
	t.Cleanup(ts.Close)

	cfg := &mcp.OAuthConfig{AuthorizationURL: ts.URL + "/authorize", TokenURL: ts.URL + "/token", ClientID: "c"}
	tokens := NewInMemoryUserTokenStore()
	mgr := NewManager(tokens, NewInMemoryStateStore(), ts.Client(), log.New(), []mcp.ServerConfig{{ID: "s", OAuth: cfg}})

	ctx := context.Background()
	// Stored token is inside the refresh window.
	_ = tokens.Put(ctx, "s", 7, Token{AccessToken: "AT1", RefreshToken: "RT1", ExpiresAt: time.Now().Add(10 * time.Second)})

	got, err := mgr.TokenFor(ctx, "s", 7)
	if err != nil {
		t.Fatalf("TokenFor: %v", err)
	}
	if got.AccessToken != "AT2" {
		t.Fatalf("expected refreshed access token, got %q", got.AccessToken)
	}
	if got.RefreshToken != "RT1" {
		t.Fatalf("expected original refresh token preserved, got %q", got.RefreshToken)
	}
	stored, ok, _ := tokens.Get(ctx, "s", 7)
	if !ok || stored.RefreshToken != "RT1" {
		t.Fatalf("persisted token lost the refresh token: %+v", stored)
	}
}

// TestNonExpiringTokenNeverRefreshes covers providers (GitHub OAuth apps)
// that omit expires_in: the token must stay usable indefinitely instead of
// being treated as expiring after an invented lifetime.
func TestNonExpiringTokenNeverRefreshes(t *testing.T) {
	cfg := &mcp.OAuthConfig{AuthorizationURL: "http://x", TokenURL: "http://x/token", ClientID: "c"}
	tokens := NewInMemoryUserTokenStore()
	mgr := NewManager(tokens, NewInMemoryStateStore(), http.DefaultClient, log.New(), []mcp.ServerConfig{{ID: "s", OAuth: cfg}})

	ctx := context.Background()
	_ = tokens.Put(ctx, "s", 7, Token{AccessToken: "AT"}) // zero ExpiresAt, no refresh token

	got, err := mgr.TokenFor(ctx, "s", 7)
	if err != nil {
		t.Fatalf("TokenFor: %v", err)
	}
	if got.AccessToken != "AT" {
		t.Fatalf("expected stored token returned as-is, got %+v", got)
	}
}
