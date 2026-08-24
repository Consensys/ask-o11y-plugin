package plugin

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/grafana/grafana-plugin-sdk-go/backend/resource/httpadapter"

	"consensys-asko11y-app/pkg/mcp"
	"consensys-asko11y-app/pkg/plugin/oauth"
)

// registerProvisionerRoutes mounts the endpoints the AppConfig UI calls to
// add or remove OAuth-gated MCP servers at runtime. All mutating routes are
// Admin-only; end users only Connect/Disconnect their own token via the
// /api/oauth routes.
func (p *Plugin) registerProvisionerRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/api/mcp/provisioner/presets", p.handleListPresets)
	mux.HandleFunc("/api/mcp/provisioner", p.handleProvisionerRoot)
	mux.HandleFunc("/api/mcp/provisioner/preset", p.handleAddPreset)
	mux.HandleFunc("/api/mcp/provisioner/generic", p.handleAddGeneric)
	mux.HandleFunc("/api/mcp/provisioner/", p.handleProvisionerItem) // DELETE /{id}
}

// handleListPresets returns the static preset catalog so the UI can render
// the preset cards without duplicating the list on the frontend.
func (p *Plugin) handleListPresets(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !isAdmin(r) {
		http.Error(w, "admin role required", http.StatusForbidden)
		return
	}
	type apiPreset struct {
		ID          oauth.PresetID `json:"id"`
		DisplayName string         `json:"displayName"`
		ServerID    string         `json:"serverId"`
		MCPURL      string         `json:"mcpUrl"`
		Transport   string         `json:"transport"`
		Scopes      []string       `json:"scopes"`
		DCRCapable  bool           `json:"dcrCapable"`
	}
	presets := oauth.Presets()
	out := make([]apiPreset, 0, len(presets))
	for _, pr := range presets {
		out = append(out, apiPreset{pr.ID, pr.DisplayName, pr.ServerID, pr.MCPURL, pr.Transport, pr.Scopes, pr.DCRCapable})
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{"presets": out})
}

// apiDynamicServer is the JSON shape for a provisioned dynamic server. OAuth
// client credentials never leave the backend.
type apiDynamicServer struct {
	ServerID    string   `json:"serverId"`
	DisplayName string   `json:"displayName"`
	MCPURL      string   `json:"mcpUrl"`
	Transport   string   `json:"transport"`
	PresetID    string   `json:"presetId,omitempty"`
	Scopes      []string `json:"scopes,omitempty"`
}

// handleProvisionerRoot lists currently provisioned dynamic servers.
func (p *Plugin) handleProvisionerRoot(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !isAdmin(r) {
		http.Error(w, "admin role required", http.StatusForbidden)
		return
	}
	records, err := p.dynamicServerStore.List(r.Context())
	if err != nil {
		p.logger.Warn("list dynamic servers", "err", err)
		http.Error(w, "list failed", http.StatusInternalServerError)
		return
	}
	out := make([]apiDynamicServer, 0, len(records))
	for _, s := range records {
		scopes := []string{}
		if s.Config.OAuth != nil {
			scopes = s.Config.OAuth.Scopes
		}
		out = append(out, apiDynamicServer{s.Config.ID, s.Config.Name, s.Config.URL, s.Config.Type, s.PresetID, scopes})
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{"servers": out})
}

type addPresetBody struct {
	Preset       oauth.PresetID `json:"preset"`
	ClientID     string         `json:"clientId,omitempty"`
	ClientSecret string         `json:"clientSecret,omitempty"`
}

func (p *Plugin) handleAddPreset(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !isAdmin(r) {
		http.Error(w, "admin role required", http.StatusForbidden)
		return
	}
	var body addPresetBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "invalid body", http.StatusBadRequest)
		return
	}
	preset, ok := oauth.Presets()[body.Preset]
	if !ok {
		http.Error(w, "unknown preset", http.StatusBadRequest)
		return
	}

	redirectURI := oauth.CallbackURL(r, preset.ServerID)
	authURL := preset.AuthEndpoint
	tokenURL := preset.TokenEndpoint
	clientID := body.ClientID
	clientSecret := body.ClientSecret
	var dcrURI, dcrToken string

	if preset.DCRCapable {
		meta, err := oauth.DiscoverMCPAuth(r.Context(), p.oauthHTTPClient, preset.MCPURL)
		if err != nil {
			p.logger.Warn("oauth discovery failed", "preset", preset.ID, "err", err)
			http.Error(w, "OAuth discovery against the provider failed", http.StatusBadGateway)
			return
		}
		authURL = meta.AuthorizationEndpoint
		tokenURL = meta.TokenEndpoint
		if clientID == "" {
			dcr, err := oauth.RegisterClient(r.Context(), p.oauthHTTPClient, meta, "ask-o11y", []string{redirectURI})
			if err != nil {
				p.logger.Warn("dynamic client registration failed", "preset", preset.ID, "err", err)
				http.Error(w, "dynamic client registration with the provider failed", http.StatusBadGateway)
				return
			}
			clientID = dcr.ClientID
			clientSecret = dcr.ClientSecret
			dcrURI = dcr.RegistrationClientURI
			dcrToken = dcr.RegistrationAccessToken
		}
	} else if clientID == "" {
		http.Error(w, "preset requires clientId (register an OAuth app at the provider first)", http.StatusBadRequest)
		return
	}

	cfg := mcp.ServerConfig{
		ID:      preset.ServerID,
		Name:    preset.DisplayName,
		URL:     preset.MCPURL,
		Type:    preset.Transport,
		Enabled: true,
		OAuth: &mcp.OAuthConfig{
			AuthorizationURL: authURL,
			TokenURL:         tokenURL,
			ClientID:         clientID,
			ClientSecret:     clientSecret,
			Scopes:           preset.Scopes,
			PKCE:             preset.PKCE,
			RedirectURI:      redirectURI,
		},
	}

	record := oauth.DynamicServer{
		Config:                  cfg,
		PresetID:                string(preset.ID),
		RegistrationClientURI:   dcrURI,
		RegistrationAccessToken: dcrToken,
	}

	if err := p.persistAndRegisterDynamicServer(r.Context(), record); err != nil {
		p.logger.Error("persist dynamic server", "err", err)
		http.Error(w, "persist failed", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{"serverId": cfg.ID})
}

type addGenericBody struct {
	ServerID         string   `json:"serverId"`
	DisplayName      string   `json:"displayName"`
	MCPURL           string   `json:"mcpUrl"`
	Transport        string   `json:"transport"` // streamable-http | sse
	AuthorizationURL string   `json:"authorizationUrl"`
	TokenURL         string   `json:"tokenUrl"`
	ClientID         string   `json:"clientId"`
	ClientSecret     string   `json:"clientSecret,omitempty"`
	Scopes           []string `json:"scopes,omitempty"`
	PKCE             bool     `json:"pkce"`
	// Discover, when true, runs RFC 8414/9728 discovery (and RFC 7591 DCR
	// when clientId is empty) to fill in the missing OAuth endpoints.
	Discover bool `json:"discover,omitempty"`
}

func validDynamicServerID(id string) bool {
	if id == "" || len(id) > 64 {
		return false
	}
	for _, r := range id {
		if (r < 'a' || r > 'z') && (r < '0' || r > '9') && r != '-' {
			return false
		}
	}
	return true
}

func (p *Plugin) handleAddGeneric(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !isAdmin(r) {
		http.Error(w, "admin role required", http.StatusForbidden)
		return
	}
	var body addGenericBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "invalid body", http.StatusBadRequest)
		return
	}
	if body.ServerID == "" || body.MCPURL == "" || body.Transport == "" {
		http.Error(w, "serverId, mcpUrl and transport are required", http.StatusBadRequest)
		return
	}
	if !validDynamicServerID(body.ServerID) {
		http.Error(w, "serverId must be 1-64 chars of [a-z0-9-]", http.StatusBadRequest)
		return
	}
	if body.Transport != "streamable-http" && body.Transport != "sse" {
		http.Error(w, "transport must be streamable-http or sse", http.StatusBadRequest)
		return
	}
	if body.DisplayName == "" {
		body.DisplayName = body.ServerID
	}

	redirectURI := oauth.CallbackURL(r, body.ServerID)
	authURL := body.AuthorizationURL
	tokenURL := body.TokenURL
	clientID := body.ClientID
	clientSecret := body.ClientSecret
	var dcrURI, dcrToken string

	if body.Discover && (authURL == "" || tokenURL == "" || clientID == "") {
		meta, err := oauth.DiscoverMCPAuth(r.Context(), p.oauthHTTPClient, body.MCPURL)
		if err != nil {
			p.logger.Warn("oauth discovery failed", "server", body.ServerID, "err", err)
			http.Error(w, "OAuth discovery against the provider failed", http.StatusBadGateway)
			return
		}
		if authURL == "" {
			authURL = meta.AuthorizationEndpoint
		}
		if tokenURL == "" {
			tokenURL = meta.TokenEndpoint
		}
		if clientID == "" {
			dcr, err := oauth.RegisterClient(r.Context(), p.oauthHTTPClient, meta, "ask-o11y", []string{redirectURI})
			if err != nil {
				p.logger.Warn("dynamic client registration failed", "server", body.ServerID, "err", err)
				http.Error(w, "dynamic client registration with the provider failed", http.StatusBadGateway)
				return
			}
			clientID = dcr.ClientID
			clientSecret = dcr.ClientSecret
			dcrURI = dcr.RegistrationClientURI
			dcrToken = dcr.RegistrationAccessToken
		}
	}
	if authURL == "" || tokenURL == "" || clientID == "" {
		http.Error(w, "authorizationUrl, tokenUrl and clientId are required (or set discover:true)", http.StatusBadRequest)
		return
	}

	cfg := mcp.ServerConfig{
		ID:      body.ServerID,
		Name:    body.DisplayName,
		URL:     body.MCPURL,
		Type:    body.Transport,
		Enabled: true,
		OAuth: &mcp.OAuthConfig{
			AuthorizationURL: authURL,
			TokenURL:         tokenURL,
			ClientID:         clientID,
			ClientSecret:     clientSecret,
			Scopes:           body.Scopes,
			PKCE:             body.PKCE,
			RedirectURI:      redirectURI,
		},
	}
	record := oauth.DynamicServer{
		Config:                  cfg,
		RegistrationClientURI:   dcrURI,
		RegistrationAccessToken: dcrToken,
	}
	if err := p.persistAndRegisterDynamicServer(r.Context(), record); err != nil {
		p.logger.Error("persist dynamic server", "err", err)
		http.Error(w, "persist failed", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{"serverId": cfg.ID})
}

func (p *Plugin) handleProvisionerItem(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/api/mcp/provisioner/")
	if id == "" || strings.Contains(id, "/") {
		http.NotFound(w, r)
		return
	}
	if r.Method != http.MethodDelete {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !isAdmin(r) {
		http.Error(w, "admin role required", http.StatusForbidden)
		return
	}
	if err := p.deleteDynamicServer(r.Context(), id); err != nil {
		p.logger.Error("delete dynamic server", "err", err)
		http.Error(w, "delete failed", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (p *Plugin) persistAndRegisterDynamicServer(ctx context.Context, record oauth.DynamicServer) error {
	if p.dynamicServerStore == nil {
		return errors.New("dynamic server store not configured")
	}
	if err := p.dynamicServerStore.Put(ctx, record); err != nil {
		return err
	}
	if record.Config.OAuth != nil {
		p.oauthManager.RegisterConfig(record.Config.ID, record.Config.OAuth)
	}
	if err := p.mcpProxy.EnsureServer(record.Config); err != nil {
		return fmt.Errorf("attach to proxy: %w", err)
	}
	return nil
}

func (p *Plugin) deleteDynamicServer(ctx context.Context, serverID string) error {
	if p.dynamicServerStore == nil {
		return errors.New("dynamic server store not configured")
	}
	if err := p.dynamicServerStore.Delete(ctx, serverID); err != nil {
		return err
	}
	p.mcpProxy.RemoveServer(serverID)
	p.oauthManager.UnregisterConfig(serverID)
	return nil
}

// isAdmin reports whether the caller holds the Grafana Admin role.
func isAdmin(r *http.Request) bool {
	pc := httpadapter.PluginConfigFromContext(r.Context())
	if pc.User != nil && strings.EqualFold(string(pc.User.Role), "Admin") {
		return true
	}
	return strings.EqualFold(getUserRole(r), "Admin")
}
