package plugin

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

var (
	// agentUserTokens counts LLM tokens consumed per user, login, model, type, org, and org_name.
	agentUserTokens = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "asko11y_agent_user_tokens_total",
			Help: "Total number of LLM tokens consumed per user, model, type, and org.",
		},
		[]string{"user", "login", "model", "type", "org", "org_name"},
	)
)

func init() {
	// Initialize zero-value metric series on plugin startup for clean PromQL initialization.
	for _, model := range []string{"base", "large"} {
		agentUserTokens.WithLabelValues("0", "unknown", model, "prompt", "1", "")
		agentUserTokens.WithLabelValues("0", "unknown", model, "completion", "1", "")
	}
}
