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
	mux := http.NewServeMux()
	var prURL, asURL string
	// The MCP endpoint: returns 401 advertising the resource metadata URL.
	mux.HandleFunc("/mcp/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("WWW-Authenticate", `Bearer error="invalid_token", resource_metadata="`+prURL+`"`)
		w.WriteHeader(http.StatusUnauthorized)
	})
	// RFC 9728 protected-resource metadata: names the authorization server.
	mux.HandleFunc("/.well-known/oauth-protected-resource/mcp/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"resource":"mcp","authorization_servers":["` + asURL + `"]}`))
	})
	// RFC 8414 authorization-server metadata.
	mux.HandleFunc("/.well-known/oauth-authorization-server", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"issuer":"i","authorization_endpoint":"i/authorize","token_endpoint":"i/token"}`))
	})
	ts := httptest.NewServer(mux)
	defer ts.Close()
	prURL = ts.URL + "/.well-known/oauth-protected-resource/mcp/"
	asURL = ts.URL

	// Ensure the first well-known probe on the MCP origin returns 404 so we
	// fall through to the challenge path. Our httptest mux does this
	// automatically since /.well-known/oauth-authorization-server is served
	// — which means we WOULD succeed on the first probe. Add the probe only
	// on a different host via a second server would overcomplicate this test.
	// Instead, swap mux to a variant without the well-known handler.
	mux2 := http.NewServeMux()
	mux2.HandleFunc("/mcp/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("WWW-Authenticate", `Bearer error="invalid_token", resource_metadata="`+ts.URL+`/.well-known/oauth-protected-resource/mcp/"`)
		w.WriteHeader(http.StatusUnauthorized)
	})
	ts2 := httptest.NewServer(mux2)
	defer ts2.Close()

	meta, err := DiscoverMCPAuth(context.Background(), ts.Client(), ts2.URL+"/mcp/")
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
