package plugin

import "regexp"

// firingPattern matches the recurring alert-investigation prompt shapes seen
// in production (Alertmanager-triggered first turns). Case-insensitive.
var firingPattern = regexp.MustCompile(`(?i)(\[FIRING[:\s]|alert investigation:|perform root cause analysis)`)

// resolveMaxIterations picks the iteration budget for an agent run. Investigation
// requests and alert-investigation patterns in the first user message get a
// higher budget so the loop can finish a full multi-signal RCA without
// tripping the limit (which in past sessions encouraged fabricated summaries).
func resolveMaxIterations(reqType, message string) int {
	if reqType == "investigation" || firingPattern.MatchString(message) {
		return AlertInvestigationMaxIter
	}
	return AgentMaxIterations
}
