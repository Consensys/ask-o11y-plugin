package mcp

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestUserIDContextRoundTrip(t *testing.T) {
	ctx := WithUserID(context.Background(), 0)
	if _, ok := UserIDFromContext(ctx); ok {
		t.Fatalf("zero user ID should not be stored")
	}
	ctx = WithUserID(context.Background(), 7)
	if v, ok := UserIDFromContext(ctx); !ok || v != 7 {
		t.Fatalf("expected 7, got %d ok=%v", v, ok)
	}
}

type stubProvider struct {
	token string
	err   error
}

func (s stubProvider) BearerFor(ctx context.Context, serverID string) (string, error) {
	return s.token, s.err
}

func TestUserTokenRoundTripperInjectsBearer(t *testing.T) {
	var gotAuth string
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
	}))
	defer ts.Close()

	rt := &userTokenRoundTripper{base: http.DefaultTransport, serverID: "s", provider: stubProvider{token: "tok"}}
	req, _ := http.NewRequestWithContext(WithUserID(context.Background(), 42), http.MethodGet, ts.URL, nil)
	resp, err := rt.RoundTrip(req)
	if err != nil {
		t.Fatalf("roundtrip: %v", err)
	}
	resp.Body.Close()
	if gotAuth != "Bearer tok" {
		t.Fatalf("expected injected bearer, got %q", gotAuth)
	}
}

func TestUserTokenRoundTripperPassesThroughWithoutUser(t *testing.T) {
	var gotAuth string
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
	}))
	defer ts.Close()

	// Provider would error, but it must not even be consulted without a user.
	rt := &userTokenRoundTripper{base: http.DefaultTransport, serverID: "s", provider: stubProvider{err: errors.New("boom")}}
	req, _ := http.NewRequest(http.MethodGet, ts.URL, nil)
	resp, err := rt.RoundTrip(req)
	if err != nil {
		t.Fatalf("roundtrip: %v", err)
	}
	resp.Body.Close()
	if gotAuth != "" {
		t.Fatalf("expected no Authorization header, got %q", gotAuth)
	}
}

func TestUserTokenRoundTripperNotConnected(t *testing.T) {
	rt := &userTokenRoundTripper{base: http.DefaultTransport, serverID: "s", provider: stubProvider{err: ErrPerUserTokenUnavailable}}
	req, _ := http.NewRequestWithContext(WithUserID(context.Background(), 42), http.MethodGet, "http://127.0.0.1:0", nil)
	_, err := rt.RoundTrip(req)
	if err == nil || !errors.Is(err, ErrPerUserTokenUnavailable) {
		t.Fatalf("expected ErrPerUserTokenUnavailable, got %v", err)
	}
	if !strings.Contains(err.Error(), "Connect") {
		t.Fatalf("expected user-actionable message, got %v", err)
	}
}

func TestConfigHeaderRoundTripperSkipsAuthorizationForOAuth(t *testing.T) {
	var gotAuth, gotOther string
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		gotOther = r.Header.Get("X-Custom")
	}))
	defer ts.Close()

	rt := &configHeaderRoundTripper{
		base:              http.DefaultTransport,
		headers:           map[string]string{"Authorization": "Bearer static", "X-Custom": "yes"},
		skipAuthorization: true,
	}
	req, _ := http.NewRequest(http.MethodGet, ts.URL, nil)
	resp, err := rt.RoundTrip(req)
	if err != nil {
		t.Fatalf("roundtrip: %v", err)
	}
	resp.Body.Close()
	if gotAuth != "" {
		t.Fatalf("static Authorization should be skipped for OAuth servers, got %q", gotAuth)
	}
	if gotOther != "yes" {
		t.Fatalf("non-auth headers should still apply, got %q", gotOther)
	}
}
