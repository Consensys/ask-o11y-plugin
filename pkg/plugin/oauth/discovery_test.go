package oauth

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestDiscoverMCPAuthWellKnown(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/.well-known/oauth-authorization-server", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"issuer":"x","authorization_endpoint":"x/authorize","token_endpoint":"x/token","registration_endpoint":"x/register"}`))
	})
	ts := httptest.NewServer(mux)
	defer ts.Close()

	meta, err := DiscoverMCPAuth(context.Background(), ts.Client(), ts.URL+"/v1/sse")
	if err != nil {
		t.Fatalf("discover: %v", err)
	}
	if meta.AuthorizationEndpoint == "" || meta.RegistrationEndpoint == "" {
		t.Fatalf("unexpected meta: %+v", meta)
	}
}

func TestDiscoverMCPAuthViaChallenge(t *testing.T) {
	// Authorization server + protected-resource metadata host.
	asMux := http.NewServeMux()
	asMux.HandleFunc("/.well-known/oauth-authorization-server", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"issuer":"i","authorization_endpoint":"i/authorize","token_endpoint":"i/token"}`))
	})
	var asURL string
	asMux.HandleFunc("/.well-known/oauth-protected-resource/mcp/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"resource":"mcp","authorization_servers":["` + asURL + `"]}`))
	})
	asServer := httptest.NewServer(asMux)
	defer asServer.Close()
	asURL = asServer.URL

	// The MCP host: no well-known metadata, 401s advertising resource metadata.
	mcpMux := http.NewServeMux()
	mcpMux.HandleFunc("/mcp/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("WWW-Authenticate", `Bearer error="invalid_token", resource_metadata="`+asServer.URL+`/.well-known/oauth-protected-resource/mcp/"`)
		w.WriteHeader(http.StatusUnauthorized)
	})
	mcpServer := httptest.NewServer(mcpMux)
	defer mcpServer.Close()

	meta, err := DiscoverMCPAuth(context.Background(), asServer.Client(), mcpServer.URL+"/mcp/")
	if err != nil {
		t.Fatalf("discover via challenge: %v", err)
	}
	if !strings.HasSuffix(meta.AuthorizationEndpoint, "authorize") {
		t.Fatalf("unexpected auth endpoint: %s", meta.AuthorizationEndpoint)
	}
}

func TestRegisterClient(t *testing.T) {
	mux := http.NewServeMux()
	var gotBody string
	mux.HandleFunc("/register", func(w http.ResponseWriter, r *http.Request) {
		buf := make([]byte, 4096)
		n, _ := r.Body.Read(buf)
		gotBody = string(buf[:n])
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"client_id":"cid","registration_client_uri":"/register/cid"}`))
	})
	ts := httptest.NewServer(mux)
	defer ts.Close()

	meta := AuthServerMetadata{RegistrationEndpoint: ts.URL + "/register"}
	res, err := RegisterClient(context.Background(), ts.Client(), meta, "ask-o11y test", []string{"http://localhost/callback"})
	if err != nil {
		t.Fatalf("register: %v", err)
	}
	if res.ClientID != "cid" {
		t.Fatalf("unexpected client_id %q", res.ClientID)
	}
	if !strings.Contains(gotBody, `"client_name":"ask-o11y test"`) {
		t.Fatalf("body did not include client_name: %s", gotBody)
	}
}

func TestRegisterClientRequiresEndpoint(t *testing.T) {
	if _, err := RegisterClient(context.Background(), http.DefaultClient, AuthServerMetadata{}, "x", nil); err == nil {
		t.Fatalf("expected error when registration_endpoint is missing")
	}
}
