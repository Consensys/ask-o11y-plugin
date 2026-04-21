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
// provider in-process so we can drive the full handshake under test.
func fakeAuthServer(t *testing.T) (*httptest.Server, *int) {
	t.Helper()
	calls := 0
	mux := http.NewServeMux()
	mux.HandleFunc("/authorize", func(w http.ResponseWriter, r *http.Request) {
		// Redirect back to the supplied redirect_uri with a fixed code.
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
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"access_token":"AT","refresh_token":"RT","expires_in":3600,"token_type":"Bearer"}`))
	})
	s := httptest.NewServer(mux)
	t.Cleanup(s.Close)
	return s, &calls
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

	tokens := NewInMemoryUserTokenStore()
	state := NewInMemoryStateStore()
	mgr := NewManager(tokens, state, log.New(), []mcp.ServerConfig{server})

	userID := int64(42)
	userIDFn := func(*http.Request) int64 { return userID }

	mux := http.NewServeMux()
	mgr.RegisterRoutes(mux, userIDFn)

	// We need the plugin HTTP server to reply with callback URLs that point
	// back to itself, so spin up a real test server around the mux.
	plugin := httptest.NewServer(mux)
	t.Cleanup(plugin.Close)
	// Override the redirect URI so both the authorize redirect and the
	// token-exchange request use the test server's URL.
	cfg.RedirectURI = plugin.URL + "/api/oauth/atlassian/callback"

	// Follow the whole chain using a cookie-less client with redirect follow.
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

	// Status should now report connected.
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
	mgr := NewManager(NewInMemoryUserTokenStore(), NewInMemoryStateStore(), log.New(), []mcp.ServerConfig{{ID: "s", OAuth: cfg}})

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
	buf := make([]byte, 2048)
	n, _ := resp.Body.Read(buf)
	if !strings.Contains(string(buf[:n]), "invalid state") {
		t.Fatalf("expected 'invalid state' in body, got %s", string(buf[:n]))
	}
}
