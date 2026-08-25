package oauth

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
)

// AuthServerMetadata is the subset of RFC 8414 metadata needed to drive the
// authorization-code flow. Fields not set by the server are left empty.
type AuthServerMetadata struct {
	Issuer                string   `json:"issuer"`
	AuthorizationEndpoint string   `json:"authorization_endpoint"`
	TokenEndpoint         string   `json:"token_endpoint"`
	RegistrationEndpoint  string   `json:"registration_endpoint,omitempty"`
	ScopesSupported       []string `json:"scopes_supported,omitempty"`
	CodeChallengeMethods  []string `json:"code_challenge_methods_supported,omitempty"`
}

// ProtectedResourceMetadata is the RFC 9728 body returned by an MCP server's
// oauth-protected-resource descriptor.
type ProtectedResourceMetadata struct {
	Resource             string   `json:"resource"`
	AuthorizationServers []string `json:"authorization_servers"`
	ScopesSupported      []string `json:"scopes_supported,omitempty"`
}

// DiscoverMCPAuth returns the authorization-server metadata for an MCP URL.
// It first tries the RFC 8414 well-known path on the MCP origin; if that
// fails it probes the MCP URL itself, follows the WWW-Authenticate
// resource_metadata hint (RFC 9728), fetches the protected-resource
// descriptor, and uses the first advertised authorization server's metadata.
func DiscoverMCPAuth(ctx context.Context, client *http.Client, mcpURL string) (AuthServerMetadata, error) {
	origin, err := originOf(mcpURL)
	if err != nil {
		return AuthServerMetadata{}, err
	}
	if meta, err := fetchAuthServerMetadata(ctx, client, origin+"/.well-known/oauth-authorization-server"); err == nil {
		return meta, nil
	}
	return discoverViaChallenge(ctx, client, mcpURL)
}

// DCRResult is the outcome of RFC 7591 dynamic client registration.
type DCRResult struct {
	ClientID                string
	ClientSecret            string
	RegistrationClientURI   string
	RegistrationAccessToken string
}

// RegisterClient performs RFC 7591 dynamic client registration and returns
// the assigned client_id (and secret, if the server issued one).
func RegisterClient(ctx context.Context, client *http.Client, meta AuthServerMetadata, clientName string, redirectURIs []string) (DCRResult, error) {
	if meta.RegistrationEndpoint == "" {
		return DCRResult{}, fmt.Errorf("authorization server does not advertise a registration_endpoint")
	}

	body := map[string]interface{}{
		"client_name":                clientName,
		"redirect_uris":              redirectURIs,
		"grant_types":                []string{"authorization_code", "refresh_token"},
		"response_types":             []string{"code"},
		"token_endpoint_auth_method": "none",
		"application_type":           "web",
	}
	raw, err := json.Marshal(body)
	if err != nil {
		return DCRResult{}, fmt.Errorf("encode DCR request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, meta.RegistrationEndpoint, strings.NewReader(string(raw)))
	if err != nil {
		return DCRResult{}, fmt.Errorf("build DCR request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		return DCRResult{}, fmt.Errorf("DCR request: %w", err)
	}
	defer resp.Body.Close()

	data, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return DCRResult{}, fmt.Errorf("read DCR response: %w", err)
	}
	if resp.StatusCode >= 400 {
		return DCRResult{}, fmt.Errorf("DCR returned %s: %s", resp.Status, strings.TrimSpace(string(data)))
	}
	var parsed struct {
		ClientID                string `json:"client_id"`
		ClientSecret            string `json:"client_secret"`
		RegistrationClientURI   string `json:"registration_client_uri"`
		RegistrationAccessToken string `json:"registration_access_token"`
	}
	if err := json.Unmarshal(data, &parsed); err != nil {
		return DCRResult{}, fmt.Errorf("decode DCR response: %w", err)
	}
	if parsed.ClientID == "" {
		return DCRResult{}, fmt.Errorf("DCR response missing client_id")
	}
	return DCRResult{
		ClientID:                parsed.ClientID,
		ClientSecret:            parsed.ClientSecret,
		RegistrationClientURI:   parsed.RegistrationClientURI,
		RegistrationAccessToken: parsed.RegistrationAccessToken,
	}, nil
}

func originOf(raw string) (string, error) {
	u, err := url.Parse(raw)
	if err != nil {
		return "", err
	}
	if u.Scheme == "" || u.Host == "" {
		return "", fmt.Errorf("url missing scheme/host: %s", raw)
	}
	return u.Scheme + "://" + u.Host, nil
}

func fetchAuthServerMetadata(ctx context.Context, client *http.Client, metaURL string) (AuthServerMetadata, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, metaURL, nil)
	if err != nil {
		return AuthServerMetadata{}, err
	}
	req.Header.Set("Accept", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return AuthServerMetadata{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return AuthServerMetadata{}, fmt.Errorf("metadata %s returned %s", metaURL, resp.Status)
	}
	var meta AuthServerMetadata
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&meta); err != nil {
		return AuthServerMetadata{}, err
	}
	if meta.AuthorizationEndpoint == "" || meta.TokenEndpoint == "" {
		return AuthServerMetadata{}, fmt.Errorf("metadata %s missing endpoints", metaURL)
	}
	return meta, nil
}

var resourceMetadataRE = regexp.MustCompile(`resource_metadata="([^"]+)"`)

// discoverViaChallenge probes the MCP URL without auth, reads the
// WWW-Authenticate header for resource_metadata, fetches that descriptor,
// then the first usable authorization server's metadata.
func discoverViaChallenge(ctx context.Context, client *http.Client, mcpURL string) (AuthServerMetadata, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, mcpURL, nil)
	if err != nil {
		return AuthServerMetadata{}, err
	}
	resp, err := client.Do(req)
	if err != nil {
		return AuthServerMetadata{}, fmt.Errorf("probe %s: %w", mcpURL, err)
	}
	defer resp.Body.Close()
	io.Copy(io.Discard, io.LimitReader(resp.Body, 1<<20))

	challenge := resp.Header.Get("WWW-Authenticate")
	match := resourceMetadataRE.FindStringSubmatch(challenge)
	if len(match) < 2 {
		return AuthServerMetadata{}, fmt.Errorf("no OAuth metadata advertised at %s (status %s)", mcpURL, resp.Status)
	}
	prMeta, err := fetchProtectedResource(ctx, client, match[1])
	if err != nil {
		return AuthServerMetadata{}, err
	}
	if len(prMeta.AuthorizationServers) == 0 {
		return AuthServerMetadata{}, fmt.Errorf("protected-resource metadata lists no authorization servers")
	}
	for _, as := range prMeta.AuthorizationServers {
		if meta, err := fetchAuthServerMetadata(ctx, client, strings.TrimSuffix(as, "/")+"/.well-known/oauth-authorization-server"); err == nil {
			return meta, nil
		}
	}
	return AuthServerMetadata{}, fmt.Errorf("no usable authorization-server metadata found")
}

func fetchProtectedResource(ctx context.Context, client *http.Client, metaURL string) (ProtectedResourceMetadata, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, metaURL, nil)
	if err != nil {
		return ProtectedResourceMetadata{}, err
	}
	req.Header.Set("Accept", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return ProtectedResourceMetadata{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return ProtectedResourceMetadata{}, fmt.Errorf("protected-resource metadata %s returned %s", metaURL, resp.Status)
	}
	var m ProtectedResourceMetadata
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&m); err != nil {
		return ProtectedResourceMetadata{}, err
	}
	return m, nil
}
