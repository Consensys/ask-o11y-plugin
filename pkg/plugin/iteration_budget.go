package plugin

import "regexp"

// firingPattern matches the recurring alert-investigation prompt shapes seen
// in production (Alertmanager-triggered first turns). Case-insensitive.
var firingPattern = regexp.MustCompile(`(?i)(\[FIRING[:\s]|alert investigation:|perform root cause analysis)`)

// isAlertInvestigation reports whether a request should be treated as an
// alert investigation — either explicitly (reqType == "investigation", set by
// the alert-notification deep link) or because the raw message looks like a
// firing-alert notification pasted directly into chat. Shared by
// resolveMaxIterations (iteration budget) and BuildSystemPrompt (efficiency
// guardrails) so a request that qualifies for the bigger iteration budget
// always also gets the guardrails that keep it fast — a Sept 2026 production
// incident found a chat-typed alert getting the former without the latter,
// producing a 21-minute, 5M-token investigation.
func isAlertInvestigation(reqType, message string) bool {
	return reqType == "investigation" || firingPattern.MatchString(message)
}

// resolveMaxIterations picks the iteration budget for an agent run. Investigation
// requests and alert-investigation patterns in the first user message get a
// higher budget so the loop can finish a full multi-signal RCA without
// tripping the limit (which in past sessions encouraged fabricated summaries).
func resolveMaxIterations(reqType, message string) int {
	if isAlertInvestigation(reqType, message) {
		return AlertInvestigationMaxIter
	}
	return AgentMaxIterations
}
