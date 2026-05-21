package plugin

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestParseAgentModelParam(t *testing.T) {
	tests := []struct {
		name string
		url  string
		want string
		ok   bool
	}{
		{name: "omitted", url: "/api/agent/run", want: "", ok: true},
		{name: "base", url: "/api/agent/run?model=base", want: "base", ok: true},
		{name: "large", url: "/api/agent/run?model=large", want: "large", ok: true},
		{name: "invalid", url: "/api/agent/run?model=opus", want: "", ok: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, tt.url, nil)
			got, ok := parseAgentModelParam(req)
			if ok != tt.ok || got != tt.want {
				t.Fatalf("parseAgentModelParam() = (%q, %v), want (%q, %v)", got, ok, tt.want, tt.ok)
			}
		})
	}
}
