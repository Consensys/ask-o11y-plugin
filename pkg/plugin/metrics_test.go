package plugin

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestRegisterRoutesMetricsEndpoint(t *testing.T) {
	p := newAgentRunTestPlugin(t)
	mux := http.NewServeMux()
	p.registerRoutes(mux)

	req := httptest.NewRequest(http.MethodGet, "/metrics", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	body := rec.Body.String()
	if !strings.Contains(body, "asko11y_agent_user_tokens_total") {
		t.Fatalf("body missing asko11y_agent_user_tokens_total: %s", body)
	}
	if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "text/plain") {
		t.Fatalf("Content-Type = %q, want text/plain", ct)
	}
}

func TestHandleMetricsRejectsPost(t *testing.T) {
	p := newAgentRunTestPlugin(t)
	req := httptest.NewRequest(http.MethodPost, "/metrics", nil)
	rec := httptest.NewRecorder()

	p.handleMetrics(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusMethodNotAllowed)
	}
}
