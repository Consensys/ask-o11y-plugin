package plugin

import (
	"net/http"
	"net/http/httptest"
	"strings"
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

func TestSelectAgentModelForTask(t *testing.T) {
	tests := []struct {
		name             string
		conversationType string
		message          string
		want             string
	}{
		{name: "simple chat uses base", conversationType: "chat", message: "What is this panel?", want: agentModelBase},
		{name: "investigation uses large", conversationType: "investigation", message: "Alert firing", want: agentModelLarge},
		{name: "performance uses large", conversationType: "performance", message: "Latency changed", want: agentModelLarge},
		{name: "topology chat uses large", conversationType: "chat", message: "Compare service topology and trace latency", want: agentModelLarge},
		{name: "long chat uses large", conversationType: "chat", message: strings.Repeat("x", 701), want: agentModelLarge},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := selectAgentModelForTask(tt.conversationType, tt.message); got != tt.want {
				t.Fatalf("selectAgentModelForTask() = %q, want %q", got, tt.want)
			}
		})
	}
}
