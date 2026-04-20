package plugin

import (
	"bytes"
	"fmt"
	"log"
	"text/template"
)

type ToolInfo struct {
	Name         string
	Description  string
	Instructions string
	DocsURL      string
	Error        string
}

type PromptContext struct {
	AlertName string
	Target    string

	// ConversationType matches the agent request type: "", chat, investigation, performance.
	// Used to append mode-specific system instructions (e.g. tighter tool discipline for investigations).
	ConversationType string

	AvailableTools []ToolInfo
	DisabledTools  []ToolInfo
	FailedTools    []ToolInfo

	OrgName  string
	UserRole string

	// DatasourceSnapshot is a short, per-run bullet list of real datasource UIDs
	// injected at session start so the LLM cannot hallucinate UIDs. Empty string
	// renders no block.
	DatasourceSnapshot string
}

type PromptRegistry struct {
	systemTemplate           *template.Template
	investigationTemplate    *template.Template
	performanceTemplate      *template.Template
	toolInstructionsTemplate *template.Template
}

func NewPromptRegistry(settings PluginSettings) (*PromptRegistry, error) {
	registry := &PromptRegistry{}

	registry.systemTemplate = parseTemplateWithFallback("system", settings.DefaultSystemPrompt, DefaultSystemPrompt)
	registry.investigationTemplate = parseTemplateWithFallback("investigation", settings.InvestigationPrompt, DefaultInvestigationPrompt)
	registry.performanceTemplate = parseTemplateWithFallback("performance", settings.PerformancePrompt, DefaultPerformancePrompt)

	var err error
	registry.toolInstructionsTemplate, err = template.New("tool_instructions").Parse(ToolInstructionsFragment)
	if err != nil {
		return nil, fmt.Errorf("failed to parse tool instructions template: %w", err)
	}

	return registry, nil
}

func parseTemplateWithFallback(name, custom, fallback string) *template.Template {
	text := custom
	if text == "" {
		text = fallback
	}
	t, err := template.New(name).Parse(text)
	if err != nil {
		log.Printf("[WARN] Invalid %s template, falling back to default: %v", name, err)
		t = template.Must(template.New(name).Parse(fallback))
	}
	return t
}

func (r *PromptRegistry) BuildSystemPrompt(ctx PromptContext) (string, error) {
	system, err := renderTemplate(r.systemTemplate, "system prompt", ctx)
	if err != nil {
		return "", err
	}
	tools, err := renderTemplate(r.toolInstructionsTemplate, "tool instructions", ctx)
	if err != nil {
		return "", err
	}
	out := system + tools
	if ctx.ConversationType == "investigation" {
		out += "\n\n---\n\n" + DefaultInvestigationModeSystemAddendum
	}
	return out, nil
}

func (r *PromptRegistry) BuildUserPrompt(convType, message string, ctx PromptContext) (string, error) {
	switch convType {
	case "investigation":
		ctx.AlertName = extractAlertNameForTitle(message)
		if ctx.AlertName == "" {
			return "", fmt.Errorf("investigation type requires alertName")
		}
		return renderTemplate(r.investigationTemplate, "investigation prompt", ctx)

	case "performance":
		ctx.Target = extractTargetForTitle(message)
		if ctx.Target == "" {
			ctx.Target = message
		}
		return renderTemplate(r.performanceTemplate, "performance prompt", ctx)

	case "chat", "":
		return message, nil

	default:
		return "", fmt.Errorf("unknown conversation type: %s", convType)
	}
}

func renderTemplate(t *template.Template, name string, data interface{}) (result string, err error) {
	defer func() {
		if r := recover(); r != nil {
			result = ""
			err = fmt.Errorf("template panic in %s: %v", name, r)
		}
	}()
	var buf bytes.Buffer
	if execErr := t.Execute(&buf, data); execErr != nil {
		return "", fmt.Errorf("failed to render %s: %w", name, execErr)
	}
	return buf.String(), nil
}

// GraphitiDiscoverySystemPrompt is the system prompt for the hidden knowledge-graph
// builder session triggered by the "Build Knowledge Graph" button. It instructs the
// agent to mine telemetry data — metrics, traces, logs — to discover the actual
// systems being monitored (not the observability platform itself).
const GraphitiDiscoverySystemPrompt = `You are a service-topology discovery agent. Your goal is to build a complete map of the MONITORED business systems — the real applications, microservices, databases, and queues — NOT the observability platform itself.

CRITICAL RULES:
- NEVER include these in your synthesis: grafana, prometheus, tempo, loki, alertmanager, mimir, alloy, otel-collector, kube-state-metrics, node-exporter, pushgateway, kube-prometheus, ingress-nginx, cert-manager, external-secrets, kyverno, elastic-webhook, keda. These are infrastructure, not business services.
- NEVER query "up" as an instant query — it returns 100KB+ of raw data that wastes context. Instead use targeted queries like count(up) by (job) or count by (service_name) (up == 1).
- Your synthesis MUST list every business service you discovered by name. If you found 30 services, list all 30.
- Do NOT synthesize until you have completed at least steps 1–3.

## Step 1 — Discover datasources
List all datasources to know what signal sources are available.

## Step 2 — Service identity from metrics (MOST IMPORTANT STEP)
Use list_prometheus_label_values to query VALUES for these labels. Make one call per label:
  a) service_name — this is the primary service inventory
  b) service
  c) job
  d) app
  e) namespace
  f) cluster

The returned values ARE the service names. Every value like "checkout", "payment", "frontend" is a real service entity.
After collecting label values, run a targeted liveness query: query_prometheus with expr "count by (service_name) (up == 1)" to see which services are alive.

## Step 3 — Trace-based topology (if Tempo is available)
Search traces to discover call edges between services:
  - Use TraceQL: {span.kind=client} to find outbound calls
  - Look for resource.service.name, server.address, db.system, messaging.system
  - This reveals A → B dependency edges

## Step 4 — Kubernetes topology (if kube-state-metrics are present)
Check for kube_deployment_labels to map workload ownership. Check kube_pod_container_status_waiting_reason for failures.

## Step 5 — Logs (if Loki is available)
Search for recent error logs to identify degraded services.

## Step 6 — Synthesize
Produce a plain-text synthesis with this EXACT structure:

### Services Discovered
For each business service (NOT infrastructure), one line:
- ServiceName (type: Service) — namespace: X, cluster: Y — health: up/degraded — signal: metric/trace/log

### Dependencies
For each known call edge:
- ServiceA → ServiceB (signal: trace/metric, protocol: HTTP/gRPC/messaging)

### Namespaces
List namespaces that contain business services.

### Health Issues
List any services with active failures (CrashLoopBackOff, errors, etc.).

REMEMBER: Your synthesis must contain the ACTUAL SERVICE NAMES you found (checkout, payment, frontend, etc.), not just "metrics are available through Prometheus". That is useless. The whole point is to name the real services.

Your final synthesis will be ingested automatically; do not call memory tools yourself.`

// GraphitiDiscoveryMessage is the initial user message for discovery sessions.
const GraphitiDiscoveryMessage = `Execute the full discovery plan step by step:
1. List datasources
2. Call list_prometheus_label_values for EACH of: service_name, service, job, app, namespace, cluster (one call per label)
3. Run query_prometheus with expr "count by (service_name) (up == 1)" — do NOT query raw "up"
4. Search traces in Tempo for call edges between services
5. Check kube-state-metrics if available
6. Synthesize — your synthesis MUST list every business service by name (e.g. "checkout", "payment", "frontend"). Filter out monitoring infrastructure (prometheus, grafana, tempo, mimir, loki, alloy, alertmanager, otel-collector, node-exporter, pushgateway, kube-prometheus, ingress-nginx).`

func BuildToolContext(orgName, userRole string) PromptContext {
	return PromptContext{
		OrgName:        orgName,
		UserRole:       userRole,
		AvailableTools: []ToolInfo{},
		DisabledTools:  []ToolInfo{},
		FailedTools:    []ToolInfo{},
	}
}
