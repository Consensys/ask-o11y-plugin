package agent

import (
	"strings"
	"testing"
)

func TestExtractRCAReport(t *testing.T) {
	content := "Verdict: payment errors.\n\n```rca-report\n{\"hypotheses\":[{\"rank\":1,\"component\":\"payment\",\"faultType\":\"high error rate\",\"confidence\":\"high\"}],\"gaps\":[\"no traces\"]}\n```\n"

	report, cleaned, hasBlock := extractRCAReport(content)
	if !hasBlock {
		t.Fatal("expected block to be detected")
	}
	if len(report.Hypotheses) != 1 || report.Hypotheses[0].Component != "payment" || len(report.Gaps) != 1 {
		t.Fatalf("parsed report = %+v", report)
	}
	if strings.Contains(cleaned, "rca-report") {
		t.Errorf("cleaned content still contains the block: %q", cleaned)
	}
	if !strings.HasPrefix(cleaned, "Verdict: payment errors.") {
		t.Errorf("cleaned content lost the prose: %q", cleaned)
	}
}

func TestExtractRCAReport_NoBlock(t *testing.T) {
	content := "Verdict: payment errors."
	report, cleaned, hasBlock := extractRCAReport(content)
	if hasBlock || len(report.Hypotheses) != 0 || cleaned != content {
		t.Errorf("no-block case: hasBlock=%v cleaned=%q", hasBlock, cleaned)
	}
}

func TestExtractRCAReport_InvalidJSONStillDetected(t *testing.T) {
	content := "Answer\n\n```rca-report\n{not json}\n```"
	_, cleaned, hasBlock := extractRCAReport(content)
	if !hasBlock {
		t.Fatal("invalid-JSON block must still be detected (and trigger repair warnings)")
	}
	if strings.Contains(cleaned, "not json") {
		t.Errorf("invalid block not stripped: %q", cleaned)
	}
}

func TestExtractRCAReport_LastBlockWins(t *testing.T) {
	content := "```rca-report\n{\"hypotheses\":[{\"rank\":1,\"component\":\"old\",\"faultType\":\"x\"}]}\n```\nmore text\n```rca-report\n{\"hypotheses\":[{\"rank\":1,\"component\":\"new\",\"faultType\":\"y\"}]}\n```"
	report, _, _ := extractRCAReport(content)
	if len(report.Hypotheses) != 1 || report.Hypotheses[0].Component != "new" {
		t.Errorf("expected the last block to win, got %+v", report.Hypotheses)
	}
}

func TestParseTopologyEdges(t *testing.T) {
	rendered := "Directed dependencies, most traffic first:\ncheckout -> payment (rps 12.34, err 10.0%)\ncheckout -> db (rps 30.00)\n\nTreat these edges as authoritative..."
	edges := parseTopologyEdges(rendered)
	if len(edges) != 2 {
		t.Fatalf("edges = %v, want 2", edges)
	}
	if _, ok := edges["checkout\x00payment"]; !ok {
		t.Errorf("missing checkout->payment: %v", edges)
	}
	if parseTopologyEdges("") != nil {
		t.Error("empty rendering must yield nil (nothing to check against)")
	}
}

func TestValidateRCAReport(t *testing.T) {
	edges := map[string]struct{}{"frontend\x00checkout": {}, "checkout\x00payment": {}}
	evidenceOK := func(id string) bool { return id == "tc_1" }

	valid := rcaReport{Hypotheses: []FinalReportHypothesis{{
		Rank: 1, Component: "payment", FaultType: "errors", EvidenceIDs: []string{"tc_1"},
		PropagationPath: []string{"frontend", "checkout", "payment"}, FirstSeen: "2026-09-25T10:05:00Z",
	}}}
	v := validateRCAReport(valid, evidenceOK, edges)
	if !v.ok() || len(v.Warnings) != 0 {
		t.Errorf("valid report flagged: %+v", v)
	}

	bogus := rcaReport{Hypotheses: []FinalReportHypothesis{{
		Rank: 1, Component: "payment", FaultType: "errors", EvidenceIDs: []string{"tc_9"},
		PropagationPath: []string{"payment", "moon"}, FirstSeen: "yesterday",
	}}}
	v = validateRCAReport(bogus, evidenceOK, edges)
	if v.ok() {
		t.Fatal("bogus report must fail")
	}
	if v.EvidenceGrounded || v.TopologyConsistent || v.TemporalOK {
		t.Errorf("all three checks must fail: %+v", v)
	}
	if len(v.Warnings) != 3 {
		t.Errorf("warnings = %v, want 3", v.Warnings)
	}

	// No topology provided: paths are not checkable and must not fail.
	v = validateRCAReport(valid, evidenceOK, nil)
	if !v.TopologyConsistent {
		t.Errorf("nil topology must skip path checks: %+v", v)
	}

	// No evidence cited: grounding fails with a warning.
	unevidenced := rcaReport{Hypotheses: []FinalReportHypothesis{{Rank: 1, Component: "payment", FaultType: "errors"}}}
	v = validateRCAReport(unevidenced, evidenceOK, nil)
	if v.EvidenceGrounded || len(v.Warnings) == 0 {
		t.Errorf("unevidenced hypothesis must warn: %+v", v)
	}

	// Empty report: no hypotheses at all.
	v = validateRCAReport(rcaReport{}, evidenceOK, edges)
	if v.ok() || len(v.Warnings) == 0 {
		t.Errorf("empty report must warn: %+v", v)
	}
}

func TestDerivedConfidence(t *testing.T) {
	if got := derivedConfidence(rcaReport{Hypotheses: []FinalReportHypothesis{
		{Rank: 2, Confidence: "low"}, {Rank: 1, Confidence: "high"},
	}}); got != "high" {
		t.Errorf("rank-1 confidence = %q, want high", got)
	}
	if got := derivedConfidence(rcaReport{Hypotheses: []FinalReportHypothesis{{Rank: 1, Confidence: "certainly"}}}); got != "medium" {
		t.Errorf("unknown level must fall back to medium, got %q", got)
	}
	if got := derivedConfidence(rcaReport{}); got != "medium" {
		t.Errorf("no hypotheses must fall back to medium, got %q", got)
	}
}
