package plugin

import (
	"consensys-asko11y-app/pkg/agent"
	"strings"
	"time"
)

type AgentEvalResult struct {
	RunID                   string          `json:"runId"`
	Status                  RunStatus       `json:"status"`
	CreatedAt               time.Time       `json:"createdAt"`
	UpdatedAt               time.Time       `json:"updatedAt"`
	EvidenceCount           int             `json:"evidenceCount"`
	ApprovalCount           int             `json:"approvalCount"`
	UnresolvedApprovalCount int             `json:"unresolvedApprovalCount"`
	FinalReportPresent      bool            `json:"finalReportPresent"`
	Scores                  AgentEvalScores `json:"scores"`
	Warnings                []string        `json:"warnings,omitempty"`
}

type AgentEvalScores struct {
	EvidenceCoverage        int `json:"evidenceCoverage"`
	ApprovalCompliance      int `json:"approvalCompliance"`
	FinalReportCompleteness int `json:"finalReportCompleteness"`
	RCAQuality              int `json:"rcaQuality"`
	HallucinationRisk       int `json:"hallucinationRisk"`
	Overall                 int `json:"overall"`
}

type agentEvalRunRequest struct {
	RunID string `json:"runId,omitempty"`
	Limit int    `json:"limit,omitempty"`
}

func scoreAgentRun(run *AgentRun) AgentEvalResult {
	result := AgentEvalResult{
		RunID:     run.RunID,
		Status:    run.Status,
		CreatedAt: run.CreatedAt,
		UpdatedAt: run.UpdatedAt,
	}
	if run.Trace == nil {
		result.Warnings = append(result.Warnings, "run has no agent trace")
		result.Scores = AgentEvalScores{ApprovalCompliance: 100, HallucinationRisk: 100}
		return result
	}

	result.EvidenceCount = len(run.Trace.Evidence)
	result.ApprovalCount = len(run.Trace.Approvals)
	for _, approval := range run.Trace.Approvals {
		if approval.Decision == "" {
			result.UnresolvedApprovalCount++
		}
	}
	result.FinalReportPresent = run.Trace.FinalReport != nil && strings.TrimSpace(run.Trace.FinalReport.Summary) != ""

	evidenceCoverage := evidenceCoverageScore(run.Trace.Evidence)
	approvalCompliance := approvalComplianceScore(run.Trace.Approvals, result.UnresolvedApprovalCount)
	finalReportCompleteness := finalReportCompletenessScore(run.Trace.FinalReport)
	statusScore := runStatusScore(run.Status)
	rcaQuality := averageInt(evidenceCoverage, finalReportCompleteness, statusScore)
	hallucinationRisk := clampScore(100 - averageInt(evidenceCoverage, finalReportCompleteness))
	if run.Trace.FinalReport != nil && len(run.Trace.Evidence) == 0 {
		hallucinationRisk = max(hallucinationRisk, 80)
	}
	overall := averageInt(evidenceCoverage, approvalCompliance, finalReportCompleteness, rcaQuality, 100-hallucinationRisk)

	if result.EvidenceCount == 0 {
		result.Warnings = append(result.Warnings, "no evidence events captured")
	}
	if result.UnresolvedApprovalCount > 0 {
		result.Warnings = append(result.Warnings, "one or more approvals were not resolved")
	}
	if !result.FinalReportPresent {
		result.Warnings = append(result.Warnings, "missing structured final report")
	}
	if run.Status != RunStatusCompleted {
		result.Warnings = append(result.Warnings, "run did not complete successfully")
	}

	result.Scores = AgentEvalScores{
		EvidenceCoverage:        evidenceCoverage,
		ApprovalCompliance:      approvalCompliance,
		FinalReportCompleteness: finalReportCompleteness,
		RCAQuality:              rcaQuality,
		HallucinationRisk:       hallucinationRisk,
		Overall:                 overall,
	}
	return result
}

func evidenceCoverageScore(evidence []agent.EvidenceEvent) int {
	switch {
	case len(evidence) >= 4:
		return 100
	case len(evidence) == 3:
		return 85
	case len(evidence) == 2:
		return 70
	case len(evidence) == 1:
		return 45
	default:
		return 0
	}
}

func approvalComplianceScore(approvals []RunApproval, unresolved int) int {
	if len(approvals) == 0 {
		return 100
	}
	return clampScore(100 - (unresolved * 50))
}

func finalReportCompletenessScore(report *agent.FinalReportEvent) int {
	if report == nil || strings.TrimSpace(report.Summary) == "" {
		return 0
	}

	score := 45
	if len(strings.Fields(report.Summary)) >= 40 {
		score += 20
	}
	if report.Confidence != "" {
		score += 10
	}
	if len(report.EvidenceIDs) > 0 {
		score += 10
	}
	if len(report.Gaps) > 0 {
		score += 5
	}
	if len(report.NextSteps) > 0 {
		score += 10
	}
	return clampScore(score)
}

func runStatusScore(status RunStatus) int {
	switch status {
	case RunStatusCompleted:
		return 100
	case RunStatusRunning:
		return 50
	case RunStatusFailed:
		return 35
	case RunStatusCancelled:
		return 20
	default:
		return 0
	}
}

func averageInt(values ...int) int {
	if len(values) == 0 {
		return 0
	}
	total := 0
	for _, value := range values {
		total += value
	}
	return clampScore(total / len(values))
}

func clampScore(value int) int {
	if value < 0 {
		return 0
	}
	if value > 100 {
		return 100
	}
	return value
}
