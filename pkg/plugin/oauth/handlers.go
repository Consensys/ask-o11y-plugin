package oauth

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"consensys-asko11y-app/pkg/mcp"
)

// UserIDFn extracts the Grafana user ID from an incoming plugin resource
// request. The plugin supplies this so we don't circular-import pkg/plugin.
type UserIDFn func(*http.Request) int64

// RegisterRoutes mounts the OAuth HTTP handlers on the given mux. All paths
// live under /api/oauth/ so the plugin's registerRoutes can delegate.
func (m *Manager) RegisterRoutes(mux *http.ServeMux, userIDFn UserIDFn) {
	mux.HandleFunc("/api/oauth/", func(w http.ResponseWriter, r *http.Request) {
		serverID, action, ok := splitOAuthPath(r.URL.Path)
		if !ok {
			http.NotFound(w, r)
			return
		}
		cfg := m.ConfigFor(serverID)
		if cfg == nil {
			http.Error(w, "server has no oauth configured", http.StatusNotFound)
			return
		}
		switch action {
		case "start":
			m.handleStart(w, r, serverID, cfg, userIDFn)
		case "callback":
			m.handleCallback(w, r, serverID, cfg)
		case "status":
			m.handleStatus(w, r, serverID, userIDFn)
		case "disconnect":
			m.handleDisconnect(w, r, serverID, userIDFn)
		default:
			http.NotFound(w, r)
		}
	})
}

// splitOAuthPath parses /api/oauth/{serverID}/{action}.
func splitOAuthPath(p string) (serverID, action string, ok bool) {
	trimmed := strings.TrimPrefix(p, "/api/oauth/")
	if trimmed == p {
		return "", "", false
	}
	parts := strings.Split(trimmed, "/")
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return "", "", false
	}
	return parts[0], parts[1], true
}

func (m *Manager) handleStart(w http.ResponseWriter, r *http.Request, serverID string, cfg *mcp.OAuthConfig, userIDFn UserIDFn) {
	userID := userIDFn(r)
	if userID == 0 {
		http.Error(w, "unauthenticated", http.StatusUnauthorized)
		return
	}

	state, err := NewState()
	if err != nil {
		m.logger.Error("generate oauth state", "err", err)
		http.Error(w, "oauth init failed", http.StatusInternalServerError)
		return
	}

	redirectURI := resolveRedirectURI(r, serverID, cfg)

	entry := StateEntry{ServerID: serverID, UserID: userID, ReturnURL: r.URL.Query().Get("return")}

	q := url.Values{}
	q.Set("response_type", "code")
	q.Set("client_id", cfg.ClientID)
	q.Set("redirect_uri", redirectURI)
	q.Set("state", state)
	if len(cfg.Scopes) > 0 {
		q.Set("scope", strings.Join(cfg.Scopes, " "))
	}
	if cfg.PKCE {
		verifier, challenge, err := NewPKCEPair()
		if err != nil {
			m.logger.Error("generate pkce pair", "err", err)
			http.Error(w, "oauth init failed", http.StatusInternalServerError)
			return
		}
		entry.CodeVerifier = verifier
		q.Set("code_challenge", challenge)
		q.Set("code_challenge_method", "S256")
	}

	if err := m.state.Put(r.Context(), state, entry); err != nil {
		m.logger.Error("persist oauth state", "err", err)
		http.Error(w, "oauth init failed", http.StatusInternalServerError)
		return
	}

	authURL := cfg.AuthorizationURL
	sep := "?"
	if strings.Contains(authURL, "?") {
		sep = "&"
	}
	http.Redirect(w, r, authURL+sep+q.Encode(), http.StatusFound)
}

func (m *Manager) handleCallback(w http.ResponseWriter, r *http.Request, serverID string, cfg *mcp.OAuthConfig) {
	q := r.URL.Query()
	if providerErr := q.Get("error"); providerErr != "" {
		writeCallbackHTML(w, serverID, false, fmt.Sprintf("%s: %s", providerErr, q.Get("error_description")))
		return
	}
	state := q.Get("state")
	code := q.Get("code")
	if state == "" || code == "" {
		writeCallbackHTML(w, serverID, false, "missing state or code")
		return
	}

	entry, err := m.state.PopAndGet(r.Context(), state)
	if err != nil {
		writeCallbackHTML(w, serverID, false, "invalid state")
		return
	}
	if entry.ServerID != serverID {
		writeCallbackHTML(w, serverID, false, "state/server mismatch")
		return
	}

	redirectURI := resolveRedirectURI(r, serverID, cfg)
	tok, err := exchangeCode(r.Context(), http.DefaultClient, cfg, code, entry.CodeVerifier, redirectURI)
	if err != nil {
		m.logger.Warn("token exchange", "server", serverID, "err", err)
		writeCallbackHTML(w, serverID, false, "token exchange failed")
		return
	}

	if err := m.tokens.Put(r.Context(), serverID, entry.UserID, tok); err != nil {
		m.logger.Error("persist token", "server", serverID, "userID", entry.UserID, "err", err)
		writeCallbackHTML(w, serverID, false, "could not persist token")
		return
	}
	writeCallbackHTML(w, serverID, true, "")
}

// StatusResponse is the JSON payload for /status.
type StatusResponse struct {
	Configured bool      `json:"configured"`
	Connected  bool      `json:"connected"`
	ExpiresAt  time.Time `json:"expiresAt,omitempty"`
}

func (m *Manager) handleStatus(w http.ResponseWriter, r *http.Request, serverID string, userIDFn UserIDFn) {
	userID := userIDFn(r)
	w.Header().Set("Content-Type", "application/json")
	if userID == 0 {
		_ = json.NewEncoder(w).Encode(StatusResponse{Configured: true})
		return
	}
	tok, ok, err := m.tokens.Get(r.Context(), serverID, userID)
	if err != nil {
		m.logger.Warn("status token lookup", "server", serverID, "err", err)
		http.Error(w, "lookup failed", http.StatusInternalServerError)
		return
	}
	resp := StatusResponse{Configured: true, Connected: ok && !tok.Expired()}
	if ok {
		resp.ExpiresAt = tok.ExpiresAt
	}
	_ = json.NewEncoder(w).Encode(resp)
}

func (m *Manager) handleDisconnect(w http.ResponseWriter, r *http.Request, serverID string, userIDFn UserIDFn) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	userID := userIDFn(r)
	if userID == 0 {
		http.Error(w, "unauthenticated", http.StatusUnauthorized)
		return
	}
	if err := m.tokens.Delete(r.Context(), serverID, userID); err != nil {
		m.logger.Warn("disconnect", "server", serverID, "err", err)
		http.Error(w, "disconnect failed", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// resolveRedirectURI returns the URL registered with the authorization
// server. It prefers the explicit config value; otherwise it reconstructs
// the plugin resource URL from the incoming request.
func resolveRedirectURI(r *http.Request, serverID string, cfg *mcp.OAuthConfig) string {
	if cfg.RedirectURI != "" {
		return cfg.RedirectURI
	}
	scheme := "https"
	if proto := r.Header.Get("X-Forwarded-Proto"); proto != "" {
		scheme = proto
	} else if r.TLS == nil {
		scheme = "http"
	}
	host := r.Header.Get("X-Forwarded-Host")
	if host == "" {
		host = r.Host
	}
	return fmt.Sprintf("%s://%s/api/plugins/consensys-asko11y-app/resources/api/oauth/%s/callback", scheme, host, serverID)
}

// writeCallbackHTML writes a tiny HTML page that notifies the opening window
// of the flow's outcome and closes itself.
func writeCallbackHTML(w http.ResponseWriter, serverID string, success bool, reason string) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	fmt.Fprintf(w, `<!DOCTYPE html>
<html><head><title>OAuth %s</title></head><body>
<p>%s</p>
<script>
try {
  if (window.opener) {
    window.opener.postMessage({source: 'asko11y-oauth', serverID: %q, success: %t, reason: %q}, '*');
  }
} catch (e) {}
setTimeout(function() { window.close(); }, 500);
</script>
</body></html>`, statusWord(success), statusWord(success), serverID, success, reason)
}

func statusWord(success bool) string {
	if success {
		return "connected"
	}
	return "failed"
}
