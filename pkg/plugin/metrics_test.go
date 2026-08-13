package plugin

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"unicode/utf8"
)

func TestRegisterRoutesDoesNotExposeMetricsEndpoint(t *testing.T) {
	p := newAgentRunTestPlugin(t)
	mux := http.NewServeMux()
	p.registerRoutes(mux)

	req := httptest.NewRequest(http.MethodGet, "/metrics", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if !strings.Contains(rec.Header().Get("Content-Type"), "application/json") {
		t.Fatalf("Content-Type = %q, want application/json from default handler", rec.Header().Get("Content-Type"))
	}
	if strings.Contains(rec.Body.String(), "asko11y_agent_user_tokens_total") {
		t.Fatalf("unexpected Prometheus metrics in response: %s", rec.Body.String())
	}
}

func TestSanitizeOrgNameLabelTruncatesByRune(t *testing.T) {
	got := sanitizeOrgNameLabel(strings.Repeat("世", 100))
	if utf8.RuneCountInString(got) != maxOrgNameLabelLength {
		t.Fatalf("rune count = %d, want %d", utf8.RuneCountInString(got), maxOrgNameLabelLength)
	}
	if !utf8.ValidString(got) {
		t.Fatalf("invalid UTF-8: %q", got)
	}
}

func TestSanitizeOrgNameLabelSafeForPrometheusLabels(t *testing.T) {
	got := sanitizeOrgNameLabel(strings.Repeat("世", 100))
	agentUserTokens.WithLabelValues("1", "user", "base", "prompt", "1", got)
}

func TestSanitizeOrgNameLabelStripsControlsAndDefaultsEmpty(t *testing.T) {
	if got := sanitizeOrgNameLabel("  \t\n  "); got != "unknown" {
		t.Fatalf("got %q, want unknown", got)
	}
	if got := sanitizeOrgNameLabel("\x00\x1f\x7f"); got != "unknown" {
		t.Fatalf("got %q, want unknown", got)
	}
}
