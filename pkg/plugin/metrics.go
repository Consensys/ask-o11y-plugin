package plugin

import (
	"strings"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

// maxOrgNameLabelLength bounds the org_name label value. orgName is supplied
// by the frontend request body rather than a trusted Grafana identity, so an
// unbounded value would let a caller inflate this counter's cardinality.
const maxOrgNameLabelLength = 64

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

// sanitizeOrgNameLabel cleans and bounds a client-supplied org name before it
// is used as a Prometheus label value.
func sanitizeOrgNameLabel(name string) string {
	name = strings.TrimSpace(name)
	if name == "" {
		return "unknown"
	}

	var b strings.Builder
	runeCount := 0
	for _, r := range name {
		if r < 0x20 || r == 0x7f {
			continue
		}
		if runeCount >= maxOrgNameLabelLength {
			break
		}
		b.WriteRune(r)
		runeCount++
	}
	name = b.String()

	if name == "" {
		return "unknown"
	}
	return name
}

func init() {
	// Initialize zero-value metric series on plugin startup for clean PromQL initialization.
	// org_name uses "unknown" to match sanitizeOrgNameLabel's fallback for empty input.
	for _, model := range []string{"base", "large"} {
		agentUserTokens.WithLabelValues("0", "unknown", model, "prompt", "1", "unknown")
		agentUserTokens.WithLabelValues("0", "unknown", model, "completion", "1", "unknown")
	}
}
