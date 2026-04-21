package oauth

import (
	"strconv"
	"strings"
)

// serverIDEscape replaces Redis key separators in server IDs so keys remain
// parseable. Server IDs come from YAML and are already validated by the
// plugin, but we stay defensive.
func serverIDEscape(s string) string {
	return strings.ReplaceAll(s, ":", "_")
}

func userIDString(id int64) string {
	return strconv.FormatInt(id, 10)
}

// tokenRedisKey is the Redis key used to store a user's token for a server.
func tokenRedisKey(serverID string, userID int64) string {
	return "mcp_oauth:" + serverIDEscape(serverID) + ":" + userIDString(userID)
}

// stateRedisKey is the Redis key for a pending OAuth state.
func stateRedisKey(state string) string {
	return "mcp_oauth_state:" + state
}
