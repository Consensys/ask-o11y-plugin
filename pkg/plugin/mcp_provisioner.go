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

// RegisterExternalMCPRoutes mounts the provisioner endpoints the AppConfig UI
// calls to add or remove OAuth-gated MCP servers at runtime.
func (p *Plugin) registerProvisionerRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/api/mcp/provisioner/presets", p.handleListPresets)
	mux.HandleFunc("/api/mcp/provisioner", p.handleProvisionerRoot)
	mux.HandleFunc("/api/mcp/provisioner/preset", p.handleAddPreset)
	mux.HandleFunc("/api/mcp/provisioner/generic", p.handleAddGeneric)
	mux.HandleFunc("/api/mcp/provisioner/", p.handleProvisionerItem) // DELETE /{id}
}

// handleListPresets returns the static preset catalog so the UI can render
// the four cards without duplicating the list on the frontend.
func (p *Plugin) handleListPresets(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	presets := oauth.Presets()
	type apiPreset struct {
		ID          oauth.PresetID `json:"id"`
		DisplayName string         `json:"displayName"`
		ServerID    string         `json:"serverId"`
		MCPURL      string         `json:"mcpUrl"`
		Transport   string         `json:"transport"`
		Scopes      []string       `json:"scopes"`
		DCRCapable  bool           `json:"dcrCapable"`
	}
	out := make([]apiPreset, 0, len(presets))
	for _, pr := range presets {
		out = append(out, apiPreset{pr.ID, pr.DisplayName, pr.ServerID, pr.MCPURL, pr.Transport, pr.Scopes, pr.DCRCapable})
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{"presets": out})
}

// handleProvisionerRoot lists currently provisioned dynamic servers.
func (p *Plugin) handleProvisionerRoot(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if p.dynamicServerStore == nil {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"servers":[]}`))
		return
	}
	records, err := p.dynamicServerStore.List(r.Context())
	if err != nil {
		p.logger.Warn("list dynamic servers", "err", err)
		http.Error(w, "list failed", http.StatusInternalServerError)
		return
	}
	type apiServer struct {
		ServerID    string   `json:"serverId"`
		DisplayName string   `json:"displayName"`
		MCPURL      string   `json:"mcpUrl"`
		Transport   string   `json:"transport"`
		PresetID    string   `json:"presetId,omitempty"`
		Scopes      []string `json:"scopes,omitempty"`
	}
	out := make([]apiServer, 0, len(records))
	for _, s := range records {
		scopes := []string{}
		if s.Config.OAuth != nil {
			scopes = s.Config.OAuth.Scopes
		}
		out = append(out, apiServer{s.Config.ID, s.Config.Name, s.Config.URL, s.Config.Type, s.PresetID, scopes})
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
	if err := p.requireAdmin(r); err != nil {
		http.Error(w, err.Error(), http.StatusForbidden)
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

	redirectURI := computeRedirectURI(r, preset.ServerID)
	authURL := preset.AuthEndpoint
	tokenURL := preset.TokenEndpoint
	clientID := body.ClientID
	clientSecret := body.ClientSecret
	var dcrURI, dcrToken string

	if preset.DCRCapable {
		meta, err := oauth.DiscoverMCPAuth(r.Context(), http.DefaultClient, preset.MCPURL)
		if err != nil {
			http.Error(w, fmt.Sprintf("discovery failed: %v", err), http.StatusBadGateway)
			return
		}
		authURL = meta.AuthorizationEndpoint
		tokenURL = meta.TokenEndpoint
		if clientID == "" {
			// Run DCR if admin did not pre-provide a client_id.
			dcr, err := oauth.RegisterClient(r.Context(), http.DefaultClient, meta, "ask-o11y", []string{redirectURI})
			if err != nil {
				http.Error(w, fmt.Sprintf("dynamic client registration failed: %v", err), http.StatusBadGateway)
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
	Discover         bool     `json:"discover,omitempty"` // if true, try RFC 8414 discovery + DCR when urls are empty
}

func (p *Plugin) handleAddGeneric(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if err := p.requireAdmin(r); err != nil {
		http.Error(w, err.Error(), http.StatusForbidden)
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
	if body.DisplayName == "" {
		body.DisplayName = body.ServerID
	}

	redirectURI := computeRedirectURI(r, body.ServerID)
	authURL := body.AuthorizationURL
	tokenURL := body.TokenURL
	clientID := body.ClientID
	clientSecret := body.ClientSecret
	var dcrURI, dcrToken string

	if body.Discover && (authURL == "" || tokenURL == "" || clientID == "") {
		meta, err := oauth.DiscoverMCPAuth(r.Context(), http.DefaultClient, body.MCPURL)
		if err != nil {
			http.Error(w, fmt.Sprintf("discovery failed: %v", err), http.StatusBadGateway)
			return
		}
		if authURL == "" {
			authURL = meta.AuthorizationEndpoint
		}
		if tokenURL == "" {
			tokenURL = meta.TokenEndpoint
		}
		if clientID == "" {
			dcr, err := oauth.RegisterClient(r.Context(), http.DefaultClient, meta, "ask-o11y", []string{redirectURI})
			if err != nil {
				http.Error(w, fmt.Sprintf("dynamic client registration failed: %v", err), http.StatusBadGateway)
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
	if err := p.requireAdmin(r); err != nil {
		http.Error(w, err.Error(), http.StatusForbidden)
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
	if p.oauthManager != nil && record.Config.OAuth != nil {
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
	if p.oauthManager != nil {
		p.oauthManager.UnregisterConfig(serverID)
	}
	return nil
}

// computeRedirectURI produces the callback URL we pass to the authorization
// server. Honors X-Forwarded-{Proto,Host} so it works behind Grafana's proxy.
func computeRedirectURI(r *http.Request, serverID string) string {
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

// requireAdmin enforces that the caller holds the Grafana Admin role. Only
// admins can add/remove MCP servers — end users only Connect/Disconnect
// their own OAuth token.
func (p *Plugin) requireAdmin(r *http.Request) error {
	pc := httpadapter.PluginConfigFromContext(r.Context())
	if pc.User != nil && strings.EqualFold(string(pc.User.Role), "Admin") {
		return nil
	}
	if strings.EqualFold(getUserRole(r), "Admin") {
		return nil
	}
	return errors.New("admin role required")
}
