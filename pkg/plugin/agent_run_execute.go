package plugin

import (
	"consensys-asko11y-app/pkg/agent"
	"consensys-asko11y-app/pkg/mcp"
	"context"
	"encoding/json"
	"net/http"

	"go.opentelemetry.io/otel/attribute"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/backend/tracing"
)

type agentRunIdentity struct {
	userID   int64
	orgID    int64
	userRole string
}

func (p *Plugin) executeDetachedAgentRun(w http.ResponseWriter, r *http.Request, orgIDStr string, ident agentRunIdentity, req agent.RunRequest, traceOp string) {
	ctx, span := tracing.DefaultTracer().Start(r.Context(), traceOp)
	defer span.End()
	r = r.WithContext(ctx)

	cfg := backend.GrafanaConfigFromContext(r.Context())
	if cfg == nil {
		p.logger.Error("Grafana configuration not available in request context")
		http.Error(w, "Grafana configuration not available", http.StatusInternalServerError)
		return
	}
	saToken, err := cfg.PluginAppClientSecret()
	if err != nil {
		p.logger.Warn("Service account token not available; built-in MCP and SA-authenticated LLM calls will not work", "error", err)
		saToken = ""
	}

	grafanaURL, urlSource := resolveGrafanaURL(p.settings, cfg)
	p.logger.Debug("Resolved Grafana URL for LLM/MCP calls", "url", grafanaURL, "source", urlSource)

	if p.useBuiltInMCP {
		if saToken == "" {
			p.logger.Warn("Built-in MCP requires a service account token; skipping built-in MCP server registration")
			p.mcpProxy.RemoveServer("mcp-grafana")
		} else {
			builtInURL := grafanaURL + "/api/plugins/grafana-llm-app/resources/mcp/grafana"
			p.mcpProxy.EnsureServer(mcp.ServerConfig{
				ID:      "mcp-grafana",
				Name:    "Grafana Built-in MCP",
				URL:     builtInURL,
				Type:    "streamable-http",
				Enabled: true,
				Headers: map[string]string{
					"Authorization": "Bearer " + saToken,
				},
			})
		}
	}

	runID, err := generateShareID()
	if err != nil {
		p.logger.Error("Failed to generate run ID", "error", err)
		http.Error(w, "Failed to generate run ID", http.StatusInternalServerError)
		return
	}

	userRole := ident.userRole
	userID := ident.userID
	numericOrgID := ident.orgID

	toolCtx := BuildToolContext(req.OrgName, userRole)
	toolCtx.ConversationType = req.Type

	systemPrompt, err := p.promptRegistry.BuildSystemPrompt(toolCtx)
	if err != nil {
		p.logger.Error("Failed to build system prompt", "error", err)
		http.Error(w, "Failed to build system prompt", http.StatusInternalServerError)
		return
	}

	userPrompt, err := p.promptRegistry.BuildUserPrompt(req.Type, req.Message, toolCtx)
	if err != nil {
		p.logger.Error("Failed to build user prompt", "error", err, "type", req.Type)
		http.Error(w, "Failed to build user prompt", http.StatusBadRequest)
		return
	}

	var messages []agent.Message
	var sessionID string

	if req.SessionID != "" {
		session, err := p.sessionStore.GetSession(req.SessionID, userID, numericOrgID)
		if err != nil {
			http.Error(w, "Session not found", http.StatusNotFound)
			return
		}
		sessionID = req.SessionID

		for _, msg := range session.Messages {
			messages = append(messages, agent.Message{
				Role:    msg.Role,
				Content: msg.Content,
			})
		}

		messages = append(messages, agent.Message{
			Role:    "user",
			Content: userPrompt,
		})

		if err := p.sessionStore.AppendMessages(sessionID, userID, numericOrgID, []SessionMessage{{
			Role:    "user",
			Content: userPrompt,
		}}); err != nil {
			p.logger.Warn("Failed to append user message", "error", err)
		}
	} else {
		messages = []agent.Message{{
			Role:    "user",
			Content: userPrompt,
		}}

		sessionTitle := generateSessionTitleFromType(req.Type, req.Message)

		session, err := p.sessionStore.CreateSession(userID, numericOrgID, sessionTitle, []SessionMessage{{
			Role:    "user",
			Content: userPrompt,
		}})
		if err != nil {
			p.logger.Error("Failed to create session", "error", err)
			http.Error(w, "Failed to create session", http.StatusInternalServerError)
			return
		}
		sessionID = session.ID

		if err := p.sessionStore.SetCurrentSessionID(userID, numericOrgID, sessionID); err != nil {
			p.logger.Warn("Failed to set current session ID", "error", err)
		}
	}

	if err := p.sessionStore.SetActiveRunID(sessionID, userID, numericOrgID, runID); err != nil {
		p.logger.Warn("Failed to set active run ID", "error", err)
	}
	p.runStore.CreateRun(runID, userID, numericOrgID)

	p.logger.Info("Agent run request",
		"role", userRole,
		"orgID", orgIDStr,
		"runId", runID,
		"sessionId", sessionID,
		"messageCount", len(messages),
		"type", req.Type,
	)

	span.SetAttributes(
		attribute.String("org_id", orgIDStr),
		attribute.String("user_role", string(userRole)),
		attribute.String("session_id", sessionID),
	)

	eventCh := make(chan agent.SSEEvent, 16)

	loopReq := agent.LoopRequest{
		Messages:           messages,
		SystemPrompt:       systemPrompt,
		MaxTotalTokens:     p.settings.MaxTotalTokens,
		RecentMessageCount: p.settings.RecentMessageCount,
		MaxIterations:      AgentMaxIterations,
		GrafanaURL:         grafanaURL,
		AuthToken:          saToken,
		UserRole:           userRole,
		OrgID:              orgIDStr,
		OrgName:            req.OrgName,
		ScopeOrgID:         req.ScopeOrgID,
	}

	detachedCtx := context.WithoutCancel(ctx)
	runCtx, runCancel := context.WithCancel(detachedCtx)

	p.runCancelsMu.Lock()
	p.runCancels[runID] = runCancel
	p.runCancelsMu.Unlock()

	go p.agentLoop.Run(runCtx, loopReq, eventCh)
	go func() {
		p.consumeAgentEvents(runID, sessionID, userID, numericOrgID, eventCh)
		runCancel()
		p.runCancelsMu.Lock()
		delete(p.runCancels, runID)
		p.runCancelsMu.Unlock()
	}()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"runId":     runID,
		"sessionId": sessionID,
		"status":    RunStatusRunning,
	})
}
