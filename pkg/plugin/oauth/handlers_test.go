package oauth

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"

	"consensys-asko11y-app/pkg/mcp"
)

// fakeAuthServer implements the authorize + token endpoints of an OAuth
// provider in-process so the full handshake can be driven under test.
func fakeAuthServer(t *testing.T) (*httptest.Server, *int) {
	t.Helper()
	calls := 0
	mux := http.NewServeMux()
	mux.HandleFunc("/authorize", func(w http.ResponseWriter, r *http.Request) {
		redirect := r.URL.Query().Get("redirect_uri")
		state := r.URL.Query().Get("state")
		http.Redirect(w, r, redirect+"?code=fake-code&state="+state, http.StatusFound)
	})
	mux.HandleFunc("/token", func(w http.ResponseWriter, r *http.Request) {
		calls++
		if err := r.ParseForm(); err != nil {
			http.Error(w, "bad form", http.StatusBadRequest)
			return
		}
		if r.FormValue("code") != "fake-code" {
			http.Error(w, "bad code", http.StatusBadRequest)
			return
		}
		if r.FormValue("code_verifier") == "" {
			http.Error(w, "missing PKCE verifier", http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"access_token":"AT","refresh_token":"RT","expires_in":3600,"token_type":"Bearer"}`))
	})
	s := httptest.NewServer(mux)
	t.Cleanup(s.Close)
	return s, &calls
}

func newTestManager(t *testing.T, servers []mcp.ServerConfig) *Manager {
	t.Helper()
	return NewManager(NewInMemoryUserTokenStore(), NewInMemoryStateStore(), http.DefaultClient, log.New(), servers)
}

func TestHandlersFullFlow(t *testing.T) {
	fake, tokenCalls := fakeAuthServer(t)

	cfg := &mcp.OAuthConfig{
		AuthorizationURL: fake.URL + "/authorize",
		TokenURL:         fake.URL + "/token",
		ClientID:         "ask-o11y",
		PKCE:             true,
	}
	server := mcp.ServerConfig{ID: "atlassian", OAuth: cfg}
	mgr := newTestManager(t, []mcp.ServerConfig{server})

	mux := http.NewServeMux()
	mgr.RegisterRoutes(mux, func(*http.Request) int64 { return 42 })

	plugin := httptest.NewServer(mux)
	t.Cleanup(plugin.Close)
	// Point the registered redirect URI back at the test server so both the
	// authorize redirect and the token exchange use it.
	cfg.RedirectURI = plugin.URL + "/api/oauth/atlassian/callback"

	resp, err := plugin.Client().Get(plugin.URL + "/api/oauth/atlassian/start")
	if err != nil {
		t.Fatalf("start GET: %v", err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 after full redirect chain, got %s", resp.Status)
	}
	if *tokenCalls != 1 {
		t.Fatalf("expected token endpoint called once, got %d", *tokenCalls)
	}

	statusResp, err := plugin.Client().Get(plugin.URL + "/api/oauth/atlassian/status")
	if err != nil {
		t.Fatalf("status GET: %v", err)
	}
	defer statusResp.Body.Close()
	var sr StatusResponse
	if err := json.NewDecoder(statusResp.Body).Decode(&sr); err != nil {
		t.Fatalf("decode status: %v", err)
	}
	if !sr.Connected {
		t.Fatalf("expected connected, got %+v", sr)
	}

	// The manager should now be able to serve the token as a bearer.
	bearer, err := mgr.BearerFor(mcp.WithUserID(t.Context(), 42), "atlassian")
	if err != nil || bearer != "AT" {
		t.Fatalf("BearerFor: bearer=%q err=%v", bearer, err)
	}

	// Disconnect flips status back.
	req, _ := http.NewRequest(http.MethodPost, plugin.URL+"/api/oauth/atlassian/disconnect", nil)
	discResp, err := plugin.Client().Do(req)
	if err != nil {
		t.Fatalf("disconnect: %v", err)
	}
	_ = discResp.Body.Close()
	if discResp.StatusCode != http.StatusNoContent {
		t.Fatalf("expected 204, got %s", discResp.Status)
	}
	statusResp2, _ := plugin.Client().Get(plugin.URL + "/api/oauth/atlassian/status")
	var sr2 StatusResponse
	_ = json.NewDecoder(statusResp2.Body).Decode(&sr2)
	statusResp2.Body.Close()
	if sr2.Connected {
		t.Fatalf("expected disconnected after disconnect, got %+v", sr2)
	}
}

func TestCallbackRejectsUnknownState(t *testing.T) {
	cfg := &mcp.OAuthConfig{AuthorizationURL: "http://x", TokenURL: "http://x/token", ClientID: "c"}
	mgr := newTestManager(t, []mcp.ServerConfig{{ID: "s", OAuth: cfg}})

	mux := http.NewServeMux()
	mgr.RegisterRoutes(mux, func(*http.Request) int64 { return 1 })
	plugin := httptest.NewServer(mux)
	t.Cleanup(plugin.Close)

	q := url.Values{"code": {"c"}, "state": {"bogus"}}
	resp, err := plugin.Client().Get(plugin.URL + "/api/oauth/s/callback?" + q.Encode())
	if err != nil {
		t.Fatalf("callback: %v", err)
	}
	defer resp.Body.Close()
	buf := make([]byte, 4096)
	n, _ := resp.Body.Read(buf)
	if !strings.Contains(string(buf[:n]), "invalid state") {
		t.Fatalf("expected 'invalid state' in body, got %s", string(buf[:n]))
	}
}

// TestCallbackEscapesProviderError guards against reflected XSS: the
// provider-controlled error/error_description query params must never reach
// the HTML or script context unescaped.
func TestCallbackEscapesProviderError(t *testing.T) {
	cfg := &mcp.OAuthConfig{AuthorizationURL: "http://x", TokenURL: "http://x/token", ClientID: "c"}
	mgr := newTestManager(t, []mcp.ServerConfig{{ID: "s", OAuth: cfg}})

	mux := http.NewServeMux()
	mgr.RegisterRoutes(mux, func(*http.Request) int64 { return 1 })
	plugin := httptest.NewServer(mux)
	t.Cleanup(plugin.Close)

	payload := `</script><script>alert(document.cookie)</script>`
	q := url.Values{"error": {"access_denied"}, "error_description": {payload}}
	resp, err := plugin.Client().Get(plugin.URL + "/api/oauth/s/callback?" + q.Encode())
	if err != nil {
		t.Fatalf("callback: %v", err)
	}
	defer resp.Body.Close()
	buf := make([]byte, 8192)
	n, _ := resp.Body.Read(buf)
	body := string(buf[:n])
	if strings.Contains(body, "</script><script>") {
		t.Fatalf("provider error reflected unescaped:\n%s", body)
	}
	if !strings.Contains(body, "access_denied") {
		t.Fatalf("expected error code to still be reported:\n%s", body)
	}
}

func TestUnknownServer404s(t *testing.T) {
	mgr := newTestManager(t, nil)
	mux := http.NewServeMux()
	mgr.RegisterRoutes(mux, func(*http.Request) int64 { return 1 })
	plugin := httptest.NewServer(mux)
	t.Cleanup(plugin.Close)

	resp, err := plugin.Client().Get(plugin.URL + "/api/oauth/nope/status")
	if err != nil {
		t.Fatalf("status GET: %v", err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("expected 404 for unknown server, got %s", resp.Status)
	}
}
