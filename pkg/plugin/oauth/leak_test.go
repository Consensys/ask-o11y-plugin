package oauth

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"consensys-asko11y-app/pkg/mcp"
)

// leakMarker is the value the fake providers put in their error bodies. The
// error text must never contain it: Grafana's review requires status-only
// errors because callers log these errors above Debug level.
const leakMarker = "LEAK-MARKER-a1b2c3"

func TestPostTokenErrorHasStatusOnly(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":"invalid_grant","access_token":"` + leakMarker + `"}`))
	}))
	defer srv.Close()

	cfg := &mcp.OAuthConfig{
		TokenURL:     srv.URL,
		ClientID:     "client",
		ClientSecret: "secret",
	}
	form := url.Values{"grant_type": {"refresh_token"}, "refresh_token": {"stale"}}

	_, err := postToken(context.Background(), srv.Client(), cfg, form)
	if err == nil {
		t.Fatal("400 from the token endpoint must return an error")
	}
	msg := err.Error()
	if strings.Contains(msg, leakMarker) {
		t.Fatalf("error leaked the provider body: %s", msg)
	}
	if !strings.Contains(msg, "400") {
		t.Fatalf("error should carry the status, got: %s", msg)
	}
}

func TestRegisterClientErrorHasStatusOnly(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		_, _ = w.Write([]byte(`{"error":"access_denied","client_secret":"` + leakMarker + `"}`))
	}))
	defer srv.Close()

	meta := AuthServerMetadata{RegistrationEndpoint: srv.URL}
	_, err := RegisterClient(context.Background(), srv.Client(), meta, "Ask O11y", []string{"https://example.test/callback"})
	if err == nil {
		t.Fatal("403 from the registration endpoint must return an error")
	}
	msg := err.Error()
	if strings.Contains(msg, leakMarker) {
		t.Fatalf("error leaked the provider body: %s", msg)
	}
	if !strings.Contains(msg, "403") {
		t.Fatalf("error should carry the status, got: %s", msg)
	}
}

// TestPostTokenSuccessStillParses guards against the redaction breaking the
// happy path.
func TestPostTokenSuccessStillParses(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"access_token":"at","refresh_token":"rt","token_type":"Bearer","expires_in":60}`))
	}))
	defer srv.Close()

	cfg := &mcp.OAuthConfig{TokenURL: srv.URL, ClientID: "client"}
	tok, err := postToken(context.Background(), srv.Client(), cfg, url.Values{"grant_type": {"authorization_code"}})
	if err != nil {
		t.Fatalf("postToken: %v", err)
	}
	if tok.AccessToken != "at" || tok.RefreshToken != "rt" {
		t.Fatalf("unexpected token: %+v", tok)
	}
	if tok.ExpiresAt.IsZero() {
		t.Fatal("expires_in should set ExpiresAt")
	}
}
