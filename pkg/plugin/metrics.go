package plugin

import (
	"net/http"
	"strings"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"github.com/prometheus/client_golang/prometheus/promhttp"
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

var metricsHandler = promhttp.Handler()

// sanitizeOrgNameLabel cleans and bounds a client-supplied org name before it
// is used as a Prometheus label value.
func sanitizeOrgNameLabel(name string) string {
	name = strings.TrimSpace(name)
	if name == "" {
		return "unknown"
	}

	var b strings.Builder
	for _, r := range name {
		if r < 0x20 || r == 0x7f {
			continue
		}
		b.WriteRune(r)
	}
	name = b.String()

	if len(name) > maxOrgNameLabelLength {
		name = name[:maxOrgNameLabelLength]
	}

	if name == "" {
		return "unknown"
	}
	return name
}

func init() {
	// Initialize zero-value metric series on plugin startup for clean PromQL initialization.
	for _, model := range []string{"base", "large"} {
		agentUserTokens.WithLabelValues("0", "unknown", model, "prompt", "1", "")
		agentUserTokens.WithLabelValues("0", "unknown", model, "completion", "1", "")
	}
}

func (p *Plugin) handleMetrics(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	metricsHandler.ServeHTTP(w, r)
}
