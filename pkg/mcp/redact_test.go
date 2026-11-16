package mcp

import (
	"strings"
	"testing"
)

// TestRedactURL guards the log-redaction contract: MCP server URLs come from
// user configuration and can carry credentials in the userinfo section or in
// query parameters, so only scheme, host and path may reach a log line.
func TestRedactURL(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want string
	}{
		{"plain", "https://mcp.example.com/sse", "https://mcp.example.com/sse"},
		{"no path", "https://mcp.example.com", "https://mcp.example.com"},
		{"port", "http://mcp:8000/time/mcp", "http://mcp:8000/time/mcp"},
		{"userinfo", "https://user:secret-token@mcp.example.com/sse", "https://mcp.example.com/sse"},
		{"query", "https://mcp.example.com/sse?api_key=secret-token", "https://mcp.example.com/sse"},
		{"hash", "https://mcp.example.com/sse#secret-token", "https://mcp.example.com/sse"},
		{"userinfo and query", "https://u:p@mcp.example.com/sse?token=abc", "https://mcp.example.com/sse"},
		{"empty", "", ""},
		{"no scheme", "mcp.example.com/sse", "<invalid-url>"},
		{"relative", "/sse", "<invalid-url>"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := RedactURL(tc.in)
			if got != tc.want {
				t.Fatalf("RedactURL(%q) = %q, want %q", tc.in, got, tc.want)
			}
			for _, secret := range []string{"secret-token", "api_key", "token=abc", "u:p@"} {
				if strings.Contains(got, secret) {
					t.Fatalf("redacted URL leaked %q: %q", secret, got)
				}
			}
		})
	}
}
