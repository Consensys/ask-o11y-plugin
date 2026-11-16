package mcp

import "net/url"

// RedactURL strips the parts of a URL that can carry credentials before the
// URL reaches a log line or an error message. It returns scheme://host/path
// only: userinfo, query parameters and fragments are dropped.
//
// Use this everywhere an MCP server URL would otherwise be logged. The URL
// comes from user configuration and may embed a token in the userinfo section
// or in a query parameter.
func RedactURL(raw string) string {
	if raw == "" {
		return ""
	}
	u, err := url.Parse(raw)
	if err != nil || u.Scheme == "" || u.Host == "" {
		return "<invalid-url>"
	}
	return u.Scheme + "://" + u.Host + u.Path
}
