package plugin

import (
	"net/http"
	"strings"
	"unicode/utf8"
)

const (
	agentModelBase  = "base"
	agentModelLarge = "large"
)

func parseAgentModelParam(r *http.Request) (string, bool) {
	model := r.URL.Query().Get("model")
	switch model {
	case "", agentModelBase, agentModelLarge:
		return model, true
	default:
		return "", false
	}
}

func persistSessionModel(store SessionStoreInterface, sessionID string, userID, orgID int64, model string) error {
	return store.UpdateSession(sessionID, userID, orgID, SessionUpdate{Model: &model})
}

func selectAgentModelForTask(conversationType, message string) string {
	switch strings.ToLower(strings.TrimSpace(conversationType)) {
	case "investigation", "performance", "discovery":
		return agentModelLarge
	}

	normalized := strings.ToLower(message)
	if utf8.RuneCountInString(normalized) > 700 {
		return agentModelLarge
	}

	largeSignals := []string{
		"root cause",
		"rca",
		"incident",
		"alert",
		"outage",
		"regression",
		"latency",
		"error budget",
		"slo",
		"trace",
		"topology",
		"dependency",
		"promql",
		"logql",
		"tempo",
		"loki",
		"mimir",
		"dashboard",
		"correlate",
		"compare",
		"deploy",
		"multi-step",
		"step by step",
		"investigate",
		"why",
	}
	for _, signal := range largeSignals {
		if strings.Contains(normalized, signal) {
			return agentModelLarge
		}
	}

	return agentModelBase
}
