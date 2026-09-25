package agent

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"time"
)

// The structured final report closes the loop on the RCA reasoning-failure
// countermeasures (arXiv 2601.22208): the model is asked (see the
// investigating-alerts skill) to end its answer with a fenced rca-report
// block ranking hypotheses with their evidence. The loop parses that block,
// validates it against what actually happened in the run, strips it from the
// user-visible content, and — when validation fails with budget remaining —
// spends ONE repair turn before emitting the report as-is with warnings.

const rcaReportFence = "```rca-report"

// repairNudgeTemplate is the one-shot system message for the repair turn.
const repairNudgeTemplate = "[SYSTEM: The rca-report block in your final answer failed validation: %s Re-emit the corrected fenced rca-report block (same format) addressing each warning, or omit the block. Do not change your verdict unless a warning justifies it.]"

// rcaReportBlockRe matches the fenced rca-report block and captures its body.
var rcaReportBlockRe = regexp.MustCompile("(?s)```rca-report\\s*\n(.*?)\n?```")

// topologyEdgeRe extracts one directed edge from a rendered topology line
// ("checkout -> payment (rps ...)").
var topologyEdgeRe = regexp.MustCompile(`^(\S+) -> (\S+)`)

// rcaReport is the parsed content of the fenced block.
type rcaReport struct {
	Hypotheses []FinalReportHypothesis `json:"hypotheses"`
	Gaps       []string                `json:"gaps"`
}

// extractRCAReport pulls the (last) rca-report block out of a final answer.
// It returns the parsed report and the content with the block stripped for
// display. hasBlock is true when a fenced block was present, even if the
// JSON inside was invalid — an invalid block must still trigger validation
// warnings rather than silently passing.
//
// An unterminated block (the answer hit the completion budget before the
// closing fence, observed in production) is treated as a block too: the
// partial JSON is never shown to the user, and the missing hypotheses still
// trip the no-hypotheses warning so the repair turn can re-emit it.
func extractRCAReport(content string) (rcaReport, string, bool) {
	matches := rcaReportBlockRe.FindAllStringSubmatch(content, -1)
	if len(matches) == 0 {
		idx := strings.LastIndex(content, rcaReportFence)
		if idx < 0 {
			return rcaReport{}, content, false
		}
		cut := strings.TrimSpace(content[:idx])
		var report rcaReport
		body := strings.TrimSpace(content[idx+len(rcaReportFence):])
		if err := json.Unmarshal([]byte(body), &report); err != nil {
			return rcaReport{}, cut, true
		}
		return report, cut, true
	}
	last := matches[len(matches)-1]

	var report rcaReport
	if err := json.Unmarshal([]byte(strings.TrimSpace(last[1])), &report); err != nil {
		return rcaReport{}, strings.Replace(content, last[0], "", 1), true
	}

	cleaned := strings.TrimSpace(strings.Replace(content, last[0], "", 1))
	return report, cleaned, true
}

// parseTopologyEdges reduces a rendered Service Topology snapshot to the set
// of directed edges, for propagation-path validation. Nil means no topology
// was provided (nothing to check against).
func parseTopologyEdges(rendered string) map[string]struct{} {
	if strings.TrimSpace(rendered) == "" {
		return nil
	}
	edges := make(map[string]struct{})
	for _, line := range strings.Split(rendered, "\n") {
		if m := topologyEdgeRe.FindStringSubmatch(strings.TrimSpace(line)); m != nil {
			edges[m[1]+"\x00"+m[2]] = struct{}{}
		}
	}
	return edges
}

// validateRCAReport checks the parsed report against run reality:
//   - every cited evidence ID must be a tool call that executed and did not
//     error (the checker closes over toolResultIsError);
//   - every firstSeen must parse as RFC3339;
//   - every propagation-path hop must be an edge of the prefetched topology
//     (skipped when no topology was provided).
func validateRCAReport(report rcaReport, evidenceOK func(id string) bool, topologyEdges map[string]struct{}) *FinalReportValidation {
	v := &FinalReportValidation{EvidenceGrounded: true, TemporalOK: true, TopologyConsistent: true}

	if len(report.Hypotheses) == 0 {
		v.EvidenceGrounded = false
		v.Warnings = append(v.Warnings, "rca-report block contains no hypotheses")
	}
	for i, h := range report.Hypotheses {
		n := i + 1
		if strings.TrimSpace(h.Component) == "" || strings.TrimSpace(h.FaultType) == "" {
			v.Warnings = append(v.Warnings, fmt.Sprintf("hypothesis %d is missing component or faultType", n))
		}
		if len(h.EvidenceIDs) == 0 {
			v.EvidenceGrounded = false
			v.Warnings = append(v.Warnings, fmt.Sprintf("hypothesis %d (%s) cites no evidence ids", n, h.Component))
			continue
		}
		for _, id := range h.EvidenceIDs {
			if !evidenceOK(id) {
				v.EvidenceGrounded = false
				v.Warnings = append(v.Warnings, fmt.Sprintf("hypothesis %d (%s) cites evidence id %q that is not a successful tool call in this run", n, h.Component, id))
			}
		}
		for j := 0; j+1 < len(h.PropagationPath); j++ {
			if topologyEdges == nil {
				break // no topology provided — nothing to check against
			}
			if _, ok := topologyEdges[h.PropagationPath[j]+"\x00"+h.PropagationPath[j+1]]; !ok {
				v.TopologyConsistent = false
				v.Warnings = append(v.Warnings, fmt.Sprintf("hypothesis %d (%s) path hop %s -> %s is not in the service topology", n, h.Component, h.PropagationPath[j], h.PropagationPath[j+1]))
			}
		}
		if h.FirstSeen != "" {
			if _, err := time.Parse(time.RFC3339, h.FirstSeen); err != nil {
				v.TemporalOK = false
				v.Warnings = append(v.Warnings, fmt.Sprintf("hypothesis %d (%s) firstSeen %q is not RFC3339", n, h.Component, h.FirstSeen))
			}
		}
	}
	return v
}

// ok reports whether the validation passed with no failed checks.
func (v *FinalReportValidation) ok() bool {
	return v != nil && v.EvidenceGrounded && v.TemporalOK && v.TopologyConsistent
}

// derivedConfidence takes the report's confidence from its rank-1 hypothesis
// when it is a known level, keeping the historical default otherwise.
func derivedConfidence(report rcaReport) string {
	for _, h := range report.Hypotheses {
		if h.Rank != 1 {
			continue
		}
		switch h.Confidence {
		case "low", "medium", "high":
			return h.Confidence
		}
	}
	return "medium"
}

func repairNudgeText(warnings []string) string {
	return fmt.Sprintf(repairNudgeTemplate, " "+strings.Join(warnings, " "))
}
