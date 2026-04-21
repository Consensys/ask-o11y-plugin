package mcp

import (
	"context"
	"errors"
	"net/http"
)

// PerUserTokenProvider supplies the Authorization header value for a given
// (request-context, serverID) pair. The provider reads the user identity
// from the context via UserIDFromContext.
type PerUserTokenProvider interface {
	BearerFor(ctx context.Context, serverID string) (string, error)
}

// mergeUserCtx returns a context rooted at base (for cancellation lifetime)
// that additionally carries the user ID from caller. Using base's cancellation
// keeps long-running client state alive across short-lived caller contexts.
func mergeUserCtx(base, caller context.Context) context.Context {
	if userID, ok := UserIDFromContext(caller); ok {
		return WithUserID(base, userID)
	}
	return base
}

type userIDCtxKey struct{}

// WithUserID returns a context carrying the Grafana user ID for downstream
// per-user token injection. A zero ID is treated as absent.
func WithUserID(ctx context.Context, userID int64) context.Context {
	if userID == 0 {
		return ctx
	}
	return context.WithValue(ctx, userIDCtxKey{}, userID)
}

// UserIDFromContext returns the Grafana user ID previously stored via
// WithUserID. The returned bool is true only when a non-zero ID is present.
func UserIDFromContext(ctx context.Context) (int64, bool) {
	v, ok := ctx.Value(userIDCtxKey{}).(int64)
	return v, ok && v != 0
}

// ErrPerUserTokenUnavailable is the sentinel returned by BearerFor when the
// user has not connected the server yet. MCP callers surface this as a
// user-visible "please connect" message rather than a silent 401.
var ErrPerUserTokenUnavailable = errors.New("per-user bearer token unavailable")

// userTokenRoundTripper wraps an http.RoundTripper for servers with an
// OAuth block. It asks the provider for the current user's bearer token on
// every request, overriding any static Authorization header.
type userTokenRoundTripper struct {
	base     http.RoundTripper
	serverID string
	provider PerUserTokenProvider
}

func (rt *userTokenRoundTripper) RoundTrip(req *http.Request) (*http.Response, error) {
	token, err := rt.provider.BearerFor(req.Context(), rt.serverID)
	if err != nil {
		return nil, err
	}
	req = req.Clone(req.Context())
	req.Header.Set("Authorization", "Bearer "+token)
	return rt.base.RoundTrip(req)
}
