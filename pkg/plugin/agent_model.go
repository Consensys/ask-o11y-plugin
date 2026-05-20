package plugin

import "net/http"

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
