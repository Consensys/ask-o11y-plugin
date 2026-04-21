package oauth

// PresetID identifies a one-click MCP provider.
type PresetID string

const (
	PresetGitHubRead  PresetID = "github-read"
	PresetGitHubWrite PresetID = "github-write"
	PresetAtlassian   PresetID = "atlassian"
)

// Preset describes a known external MCP provider the admin can add with one
// click from the UI. For providers that support RFC 7591 dynamic client
// registration (Atlassian), DCRCapable is true and the client_id is issued
// automatically. For providers that require a pre-registered OAuth app
// (GitHub), DCRCapable is false and the admin must supply clientID +
// clientSecret at provisioning time.
type Preset struct {
	ID            PresetID
	DisplayName   string   // shown in the UI card + as the MCP server name
	ServerID      string   // the ID the ServerConfig will take (unique per preset)
	MCPURL        string   // endpoint that speaks MCP over HTTP
	Transport     string   // "streamable-http" | "sse"
	Scopes        []string // scopes requested in the authorize URL
	DCRCapable    bool
	AuthEndpoint  string // used only when DCRCapable is false
	TokenEndpoint string // used only when DCRCapable is false
	PKCE          bool
}

// Presets returns the built-in preset catalog.
func Presets() map[PresetID]Preset {
	return map[PresetID]Preset{
		PresetGitHubRead: {
			ID:            PresetGitHubRead,
			DisplayName:   "GitHub (read-only)",
			ServerID:      "github-read",
			MCPURL:        "https://api.githubcopilot.com/mcp/",
			Transport:     "streamable-http",
			Scopes:        []string{"read:user", "read:org", "read:project", "read:packages", "notifications"},
			DCRCapable:    false,
			AuthEndpoint:  "https://github.com/login/oauth/authorize",
			TokenEndpoint: "https://github.com/login/oauth/access_token",
			PKCE:          true,
		},
		PresetGitHubWrite: {
			ID:            PresetGitHubWrite,
			DisplayName:   "GitHub (read / write)",
			ServerID:      "github-write",
			MCPURL:        "https://api.githubcopilot.com/mcp/",
			Transport:     "streamable-http",
			Scopes:        []string{"repo", "user:email", "read:org", "project", "workflow", "write:packages", "notifications", "codespace"},
			DCRCapable:    false,
			AuthEndpoint:  "https://github.com/login/oauth/authorize",
			TokenEndpoint: "https://github.com/login/oauth/access_token",
			PKCE:          true,
		},
		PresetAtlassian: {
			ID:          PresetAtlassian,
			DisplayName: "Atlassian (Jira + Confluence)",
			ServerID:    "atlassian",
			MCPURL:      "https://mcp.atlassian.com/v1/sse",
			Transport:   "sse",
			Scopes:      []string{"offline_access"},
			DCRCapable:  true,
			PKCE:        true,
		},
	}
}
