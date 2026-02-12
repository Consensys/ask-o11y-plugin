package plugin

import (
	"os"
	"testing"
)

func TestBuiltInMCPBaseURL(t *testing.T) {
	// Save and restore env vars
	origOverride := os.Getenv("GF_PLUGIN_ASKO11Y_BUILTIN_MCP_BASE_URL")
	origPort := os.Getenv("GF_SERVER_HTTP_PORT")
	defer func() {
		os.Setenv("GF_PLUGIN_ASKO11Y_BUILTIN_MCP_BASE_URL", origOverride)
		os.Setenv("GF_SERVER_HTTP_PORT", origPort)
	}()

	t.Run("default returns localhost:3000", func(t *testing.T) {
		os.Unsetenv("GF_PLUGIN_ASKO11Y_BUILTIN_MCP_BASE_URL")
		os.Unsetenv("GF_SERVER_HTTP_PORT")
		got := builtInMCPBaseURL()
		if got != "http://localhost:3000" {
			t.Errorf("builtInMCPBaseURL() = %q, want %q", got, "http://localhost:3000")
		}
	})

	t.Run("respects GF_SERVER_HTTP_PORT", func(t *testing.T) {
		os.Unsetenv("GF_PLUGIN_ASKO11Y_BUILTIN_MCP_BASE_URL")
		os.Setenv("GF_SERVER_HTTP_PORT", "8080")
		got := builtInMCPBaseURL()
		if got != "http://localhost:8080" {
			t.Errorf("builtInMCPBaseURL() = %q, want %q", got, "http://localhost:8080")
		}
	})

	t.Run("override takes precedence", func(t *testing.T) {
		os.Setenv("GF_PLUGIN_ASKO11Y_BUILTIN_MCP_BASE_URL", "http://grafana.svc:3000")
		os.Setenv("GF_SERVER_HTTP_PORT", "8080")
		got := builtInMCPBaseURL()
		if got != "http://grafana.svc:3000" {
			t.Errorf("builtInMCPBaseURL() = %q, want %q", got, "http://grafana.svc:3000")
		}
	})

	t.Run("override strips trailing slash", func(t *testing.T) {
		os.Setenv("GF_PLUGIN_ASKO11Y_BUILTIN_MCP_BASE_URL", "http://grafana.svc:3000/")
		got := builtInMCPBaseURL()
		if got != "http://grafana.svc:3000" {
			t.Errorf("builtInMCPBaseURL() = %q, want %q", got, "http://grafana.svc:3000")
		}
	})
}
