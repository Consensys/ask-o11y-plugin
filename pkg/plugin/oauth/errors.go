package oauth

import "errors"

// ErrOAuthNotConnected is returned by the OAuth round tripper when no token
// is stored for the current user on a given MCP server. Agents should surface
// it to the UI so the user can click "Connect".
var ErrOAuthNotConnected = errors.New("oauth: user not connected")

// ErrStateInvalid is returned by the callback handler when the OAuth state
// parameter is missing, expired, or does not match the one we issued. Never
// leak details beyond "invalid state" to the browser.
var ErrStateInvalid = errors.New("oauth: invalid state")
