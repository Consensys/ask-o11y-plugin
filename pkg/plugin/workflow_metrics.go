package plugin

import (
	"strings"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

// Workflow metric label bounds. Workflow names come from plugin settings, so
// an unbounded value would let a misconfigured entry inflate cardinality.
const maxWorkflowLabelLength = 64

var (
	// workflowTicks counts scheduler ticks per workflow and outcome.
	// outcome: executed | skip_lock | skip_identity | skip_error.
	workflowTicks = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "asko11y_workflow_ticks_total",
			Help: "Workflow scheduler ticks per workflow and outcome (executed, skip_lock, skip_identity, skip_error).",
		},
		[]string{"workflow", "outcome"},
	)

	// workflowSessions counts sessions per workflow and outcome.
	// outcome: started | completed | failed | cancelled | timeout.
	workflowSessions = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "asko11y_workflow_sessions_total",
			Help: "Workflow sessions per workflow and outcome (started, completed, failed, cancelled, timeout).",
		},
		[]string{"workflow", "outcome"},
	)

	// workflowActiveSpawned gauges active spawned sessions per workflow,
	// sourced from the Redis active set.
	workflowActiveSpawned = promauto.NewGaugeVec(
		prometheus.GaugeOpts{
			Name: "asko11y_workflow_active_spawned",
			Help: "Active spawned sessions per workflow, counted across replicas through Redis.",
		},
		[]string{"workflow"},
	)

	// workflowRunDuration observes wall-clock session duration per workflow.
	workflowRunDuration = promauto.NewHistogramVec(
		prometheus.HistogramOpts{
			Name:    "asko11y_workflow_run_duration_seconds",
			Help:    "Workflow session duration in seconds per workflow.",
			Buckets: []float64{10, 30, 60, 120, 300, 600, 1800},
		},
		[]string{"workflow"},
	)
)

// workflowLabel sanitizes a workflow name into a bounded metric label.
func workflowLabel(name string) string {
	name = strings.TrimSpace(name)
	if name == "" {
		return "unknown"
	}
	if len(name) > maxWorkflowLabelLength {
		name = name[:maxWorkflowLabelLength]
	}
	return name
}

// observeWorkflowRunDuration records a finished session's wall-clock time.
func observeWorkflowRunDuration(workflow string, d time.Duration) {
	workflowRunDuration.WithLabelValues(workflowLabel(workflow)).Observe(d.Seconds())
}
