package plugin

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"sync/atomic"
	"time"

	"consensys-asko11y-app/pkg/agent"
	"consensys-asko11y-app/pkg/skills"
)

// workflowRunParams carries everything one headless workflow session needs.
// The tick path fills it from the entry; the spawn tool fills it from a
// dispatcher's spawn_session call.
type workflowRunParams struct {
	entry       WorkflowEntry
	skill       string
	message     string
	grafanaURL  string
	saToken     string
	syntheticID int64
	spawned     bool
	isFallback  bool
}

// startWorkflowSession does the synchronous setup for one headless session
// with a freshly generated run ID. See startWorkflowSessionWithID.
func (p *Plugin) startWorkflowSession(params workflowRunParams) (string, string, error) {
	runID, err := generateShareID()
	if err != nil {
		return "", "", fmt.Errorf("run ID generation failed: %w", err)
	}
	return p.startWorkflowSessionWithID(params, runID)
}

// startWorkflowSessionWithID does the synchronous setup for one headless
// session under a caller-supplied run ID — skill activation, prompt build,
// session and run records — then launches the loop and its watchdog in
// goroutines and returns the identifiers. It never blocks on the LLM. The
// spawn tool supplies the ID so Redis admission and the run record use the
// same identifier.
func (p *Plugin) startWorkflowSessionWithID(params workflowRunParams, runID string) (string, string, error) {
	entry := params.entry
	name := entry.Name
	orgID := entry.OrgID
	orgIDStr := strconv.FormatInt(orgID, 10)
	orgName := "Org" + orgIDStr
	userRole := "Editor"

	activation, err := skills.Resolve(p.skillRegistry, params.message, []string{params.skill}, "")
	if err != nil {
		workflowSessions.WithLabelValues(workflowLabel(name), "failed").Inc()
		p.workflowStatus.RecordSession(name, "failed")
		return "", "", fmt.Errorf("workflow %s: skill activation failed: %w", name, err)
	}

	toolCtx := BuildToolContext(orgName, userRole)
	toolCtx.ConversationType = workflowConversationType
	toolCtx.Message = params.message
	toolCtx.ActiveSkills = activation.Skills
	toolCtx.SkillsCatalog = p.skillRegistry.Catalog(skills.ActiveNames(activation)...)
	toolCtx.UserPromptSkill = activation.UserPromptSkill

	systemPrompt, err := p.promptRegistry.BuildSystemPrompt(toolCtx)
	if err != nil {
		workflowSessions.WithLabelValues(workflowLabel(name), "failed").Inc()
		p.workflowStatus.RecordSession(name, "failed")
		return "", "", fmt.Errorf("workflow %s: system prompt build failed: %w", name, err)
	}
	if p.isGraphitiAvailable() {
		systemPrompt += graphitiKnowledgePrompt(orgGroupID(orgID))
	}
	userPrompt, err := p.promptRegistry.BuildUserPrompt(workflowConversationType, params.message, toolCtx)
	if err != nil {
		workflowSessions.WithLabelValues(workflowLabel(name), "failed").Inc()
		p.workflowStatus.RecordSession(name, "failed")
		return "", "", fmt.Errorf("workflow %s: user prompt build failed: %w", name, err)
	}

	title := fmt.Sprintf("Workflow %s: %s", name, params.skill)
	if params.spawned {
		title = fmt.Sprintf("Workflow %s (spawned): %s", name, params.skill)
	}
	session, err := p.sessionStore.CreateSession(params.syntheticID, orgID, title, []SessionMessage{{
		Role:    "user",
		Content: userPrompt,
	}})
	if err != nil {
		workflowSessions.WithLabelValues(workflowLabel(name), "failed").Inc()
		p.workflowStatus.RecordSession(name, "failed")
		return "", "", fmt.Errorf("workflow %s: session creation failed: %w", name, err)
	}
	sessionID := session.ID
	convType := workflowConversationType
	if updateErr := p.sessionStore.UpdateSession(sessionID, params.syntheticID, orgID, SessionUpdate{
		ConversationType: &convType,
		Workflow:         &name,
	}); updateErr != nil {
		p.logger.Warn("Failed to tag workflow session metadata", "error", updateErr, "sessionId", sessionID)
	}
	p.runStore.CreateRun(runID, params.syntheticID, orgID, sessionID)

	runModel := entry.Model
	modelSource := "workflow"
	if runModel == "" {
		if m := skills.ModelPreference(activation); m != "" {
			runModel = m
			modelSource = "skill"
		} else {
			runModel = agentModelBase
		}
	}
	if err := persistSessionModel(p.sessionStore, sessionID, params.syntheticID, orgID, runModel); err != nil {
		p.logger.Warn("Failed to persist workflow session model", "error", err, "sessionId", sessionID)
	}
	if err := p.sessionStore.SetActiveRunID(sessionID, params.syntheticID, orgID, runID); err != nil {
		p.logger.Warn("Failed to set workflow active run ID", "error", err, "sessionId", sessionID)
	}

	maxIterations := entry.MaxIterations
	if maxIterations <= 0 {
		maxIterations = skills.IterationBudget(activation)
	}

	loopReq := agent.LoopRequest{
		Messages: []agent.Message{{
			Role:    "user",
			Content: userPrompt,
		}},
		SystemPrompt:       systemPrompt,
		MaxTotalTokens:     p.settings.MaxTotalTokens,
		RecentMessageCount: p.settings.RecentMessageCount,
		ContextLimits:      contextLimitsFromSettings(p.settings),
		MaxIterations:      maxIterations,
		Model:              runModel,
		AllowModelFallback: modelSource == "skill" && runModel == agentModelLarge,
		ConversationType:   workflowConversationType,
		RunID:              runID,
		SessionID:          sessionID,
		ActiveSkillsEvent:  skillEventInfos(activation.Skills),
		AvailableSkills:    skillSpecs(toolCtx.SkillsCatalog),
		LoadSkill: func(ctx context.Context, skillName, file string) (string, error) {
			return p.skillRegistry.Load(skillName, file, toolCtx)
		},
		GrafanaURL:           params.grafanaURL,
		AuthToken:            params.saToken,
		UserRole:             userRole,
		UserID:               params.syntheticID,
		OrgID:                orgIDStr,
		OrgName:              orgName,
		ExcludeToolNames:     graphitiWriteToolNames,
		AllowToolNames:       entry.ToolAllowlist,
		MCPServers:           p.settingsForFilter(),
		ApprovalPolicy:       "off",
		MaxParallelToolCalls: p.settings.MaxParallelToolCalls,
		ToolSearch:           p.settings.ToolSearch,
		InternalTools:        p.buildWorkflowInternalTools(params, sessionID, runID),
	}

	p.logger.Info("Workflow session started",
		"workflow", name,
		"skill", params.skill,
		"sessionId", sessionID,
		"runId", runID,
		"spawned", params.spawned,
		"model", runModel,
	)
	workflowSessions.WithLabelValues(workflowLabel(name), "started").Inc()
	p.workflowStatus.RecordSession(name, "started")

	eventCh := make(chan agent.SSEEvent, 16)
	runCtx, runCancel := context.WithCancel(p.ctx)

	p.runCancelsMu.Lock()
	if p.runCancels != nil {
		p.runCancels[runID] = runCancel
	} else {
		// Dispose already cleared the registry: the plugin is shutting down.
		// Cancel now so this session ends immediately instead of assigning
		// into a nil map.
		runCancel()
	}
	p.runCancelsMu.Unlock()

	var timedOut atomic.Bool
	timeout := time.Duration(entry.SessionTimeoutSeconds) * time.Second
	timer := time.AfterFunc(timeout, func() {
		timedOut.Store(true)
		runCancel()
	})

	go p.agentLoop.Run(runCtx, loopReq, eventCh)
	go func() {
		defer timer.Stop()
		started := time.Now()
		login := "workflow-" + workflowLabel(name)
		p.consumeAgentEvents(runID, sessionID, params.syntheticID, login, orgID, orgName, runModel, eventCh)

		runCancel()
		p.runCancelsMu.Lock()
		delete(p.runCancels, runID)
		p.runCancelsMu.Unlock()

		// The run status is read first: a run that completed right at the
		// deadline stays completed even if the watchdog timer fired in the
		// race window between the consumer returning and the timer stopping.
		run, getErr := p.runStore.GetRun(runID)
		outcome := "failed"
		if getErr == nil && run.Status == RunStatusCompleted {
			outcome = "completed"
		} else if timedOut.Load() {
			p.runStore.FinishRun(runID, RunStatusFailed,
				fmt.Sprintf("workflow session exceeded its %d second timeout", entry.SessionTimeoutSeconds))
			outcome = "timeout"
		} else if getErr == nil {
			switch run.Status {
			case RunStatusCancelled:
				outcome = "cancelled"
			}
		}
		workflowSessions.WithLabelValues(workflowLabel(name), outcome).Inc()
		p.workflowStatus.RecordSession(name, outcome)
		observeWorkflowRunDuration(name, time.Since(started))

		if params.spawned {
			p.workflowActiveSpawnRemove(name, runID)
		}

		if outcome == "timeout" || outcome == "failed" {
			p.maybeRunWorkflowFallback(params, outcome)
		}
	}()

	return sessionID, runID, nil
}

// maybeRunWorkflowFallback runs the configured fallback skill once after a
// failed or timed-out session. A fallback never spawns another fallback.
func (p *Plugin) maybeRunWorkflowFallback(params workflowRunParams, outcome string) {
	entry := params.entry
	if entry.FallbackSkill == "" || params.isFallback {
		return
	}
	fallbackMessage := fmt.Sprintf(
		"The %s workflow session for skill %s %s without completing. Execute the fallback instructions now.",
		entry.Name, params.skill, outcome)
	fallbackParams := workflowRunParams{
		entry:       entry,
		skill:       entry.FallbackSkill,
		message:     fallbackMessage,
		grafanaURL:  params.grafanaURL,
		saToken:     params.saToken,
		syntheticID: params.syntheticID,
		spawned:     false,
		isFallback:  true,
	}
	p.logger.Info("Workflow fallback session starting",
		"workflow", entry.Name, "skill", entry.FallbackSkill, "after", outcome)
	if _, _, err := p.startWorkflowSession(fallbackParams); err != nil {
		p.logger.Error("Workflow fallback session failed to start",
			"workflow", entry.Name, "skill", entry.FallbackSkill, "error", err)
	}
}

// buildWorkflowInternalTools injects the workflow-only tools for one session:
// share_session always; spawn_session only for a top-level dispatcher session
// of a workflow that allows spawning. They exist nowhere else.
func (p *Plugin) buildWorkflowInternalTools(params workflowRunParams, sessionID, runID string) []agent.InternalTool {
	entry := params.entry
	tools := []agent.InternalTool{p.workflowShareTool(params, sessionID, runID)}
	if !params.spawned && !params.isFallback && len(entry.SpawnableSkills) > 0 {
		tools = append(tools, p.workflowSpawnTool(params))
	}
	return tools
}

// spawnSessionToolName / shareSessionToolName are the two internal tools of
// the workflow runner. Their names never appear in the interactive catalog.
const (
	spawnSessionToolName = "spawn_session"
	shareSessionToolName = "share_session"
)

func (p *Plugin) workflowSpawnTool(params workflowRunParams) agent.InternalTool {
	entry := params.entry
	allowed := append([]string(nil), entry.SpawnableSkills...)
	return agent.InternalTool{
		Name: spawnSessionToolName,
		Description: "Starts a new unattended investigation session for a skill this workflow may spawn, " +
			"and returns its sessionId and runId. Bounded by the workflow's concurrency cap; when the cap is " +
			"reached the call fails and work must wait for a later run.",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"skill": map[string]interface{}{
					"type":        "string",
					"description": "Skill to run in the spawned session. Allowed: " + joinQuoted(allowed),
				},
				"message": map[string]interface{}{
					"type":        "string",
					"description": "The first message of the spawned session: the item to investigate, with every identifier it needs.",
				},
			},
			"required": []string{"skill", "message"},
		},
		Handler: func(ctx context.Context, arguments string) (string, bool) {
			return p.handleWorkflowSpawn(params, arguments, allowed)
		},
	}
}

// handleWorkflowSpawn executes one spawn_session call.
func (p *Plugin) handleWorkflowSpawn(params workflowRunParams, arguments string, allowed []string) (string, bool) {
	var args struct {
		Skill   string `json:"skill"`
		Message string `json:"message"`
	}
	if err := json.Unmarshal([]byte(arguments), &args); err != nil {
		return fmt.Sprintf("Invalid spawn_session arguments: %v", err), true
	}
	if args.Skill == "" || args.Message == "" {
		return "spawn_session requires 'skill' and 'message' arguments", true
	}
	if !containsString(allowed, args.Skill) {
		return fmt.Sprintf("spawn_session refused: skill %s is not spawnable for this workflow. Allowed skills: %s",
			args.Skill, joinQuoted(allowed)), true
	}

	// Admission is atomic and uses the real run ID: the count and the add
	// are one Redis script, so overlapping ticks or parallel tool calls
	// cannot both pass the cap, and a refused spawn starts no session.
	runID, err := generateShareID()
	if err != nil {
		return fmt.Sprintf("spawn_session failed: %v", err), true
	}
	deadline := time.Now().Add(time.Duration(params.entry.SessionTimeoutSeconds) * time.Second)
	admitted, err := p.workflowActiveSpawnTryAdd(params.entry.Name, runID, deadline, params.entry.MaxConcurrentSessions)
	if err != nil {
		return fmt.Sprintf("spawn_session refused: the concurrency check is unavailable (%v); retry on a later run", err), true
	}
	if !admitted {
		return fmt.Sprintf("spawn_session refused: the workflow is at its cap of %d active sessions. Finish or wait; retry on a later run",
			params.entry.MaxConcurrentSessions), true
	}

	sessionID, _, err := p.startWorkflowSessionWithID(workflowRunParams{
		entry:       params.entry,
		skill:       args.Skill,
		message:     args.Message,
		grafanaURL:  params.grafanaURL,
		saToken:     params.saToken,
		syntheticID: params.syntheticID,
		spawned:     true,
		isFallback:  false,
	}, runID)
	if err != nil {
		// Release the admission slot the failed start never occupied with a
		// running session.
		p.workflowActiveSpawnRemove(params.entry.Name, runID)
		return fmt.Sprintf("spawn_session failed: %v", err), true
	}
	p.workflowActiveSpawnRefreshGauge(params.entry.Name)

	result, _ := json.Marshal(map[string]string{"sessionId": sessionID, "runId": runID})
	return string(result), false
}

func (p *Plugin) workflowShareTool(params workflowRunParams, sessionID, runID string) agent.InternalTool {
	return agent.InternalTool{
		Name: shareSessionToolName,
		Description: "Creates a share link for this session that a human can open without logging in as you, " +
			"and returns the full URL. The link snapshots everything so far, so call it once your investigation " +
			"and findings are written out, and post that URL wherever you publish the findings.",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"expiresInDays": map[string]interface{}{
					"type":        "number",
					"description": "Optional link lifetime in days; defaults to 30.",
				},
			},
		},
		Handler: func(ctx context.Context, arguments string) (string, bool) {
			return p.handleWorkflowShare(params, sessionID, runID, arguments)
		},
	}
}

// handleWorkflowShare executes one share_session call. The snapshot is the
// live investigation, not just the persisted session: assistant messages and
// tool results only land in the session store after the loop finishes, so
// the share merges the stored messages with this run's events so far.
func (p *Plugin) handleWorkflowShare(params workflowRunParams, sessionID, runID, arguments string) (string, bool) {
	var args struct {
		ExpiresInDays int `json:"expiresInDays,omitempty"`
	}
	if arguments != "" {
		if err := json.Unmarshal([]byte(arguments), &args); err != nil {
			return fmt.Sprintf("Invalid share_session arguments: %v", err), true
		}
	}
	if args.ExpiresInDays < 0 || args.ExpiresInDays > 365 {
		return "share_session refused: expiresInDays must be between 0 and 365", true
	}
	days := args.ExpiresInDays
	if days == 0 {
		days = 30
	}

	session, err := p.sessionStore.GetSession(sessionID, params.syntheticID, params.entry.OrgID)
	if err != nil {
		return fmt.Sprintf("share_session failed: session %s could not be read: %v", sessionID, err), true
	}

	snapshot := workflowShareSnapshot{
		ID:               session.ID,
		Title:            session.Title,
		ConversationType: session.ConversationType,
		Workflow:         session.Workflow,
		CreatedAt:        session.CreatedAt,
		Messages:         append([]SessionMessage(nil), session.Messages...),
	}
	snapshot.Messages = append(snapshot.Messages, workflowRunTranscript(p, runID)...)

	data, err := json.Marshal(snapshot)
	if err != nil {
		return fmt.Sprintf("share_session failed: session snapshot could not be encoded: %v", err), true
	}
	if err := ValidateSessionData(data); err != nil {
		return fmt.Sprintf("share_session failed: session snapshot is invalid: %v", err), true
	}

	hours := days * 24
	share, err := p.shareStore.CreateShare(sessionID, data, params.entry.OrgID, params.syntheticID, &hours)
	if err != nil {
		return fmt.Sprintf("share_session failed: %v", err), true
	}
	return fmt.Sprintf("Share link (valid %d days): %s/a/%s/shared/%s?orgId=%d",
		days, params.grafanaURL, PluginID, share.ShareID, params.entry.OrgID), false
}

// workflowShareSnapshot is the session-shaped payload stored for a workflow
// share: the same fields the shared-session viewer renders.
type workflowShareSnapshot struct {
	ID               string           `json:"id"`
	Title            string           `json:"title"`
	ConversationType string           `json:"conversationType,omitempty"`
	Workflow         string           `json:"workflow,omitempty"`
	CreatedAt        time.Time        `json:"createdAt"`
	Messages         []SessionMessage `json:"messages"`
}

// workflowRunTranscript renders a run's SSE events as the assistant message
// a human opening the share link should read. It reuses
// reconstructAssistantMessage, which already handles both event encodings —
// typed structs from an in-memory run store and JSON maps from the Redis run
// store — and merges each tool call with its result.
func workflowRunTranscript(p *Plugin, runID string) []SessionMessage {
	run, err := p.runStore.GetRun(runID)
	if err != nil || len(run.Events) == 0 {
		return nil
	}
	message := reconstructAssistantMessage(run.Events)
	if strings.TrimSpace(message.Content) == "" && len(message.ToolCalls) == 0 {
		return nil
	}
	return []SessionMessage{message}
}

// joinQuoted renders a short "a", "b", "c" list for tool descriptions and
// refusal messages.
func joinQuoted(values []string) string {
	out := ""
	for i, v := range values {
		if i > 0 {
			out += ", "
		}
		out += `"` + v + `"`
	}
	return out
}

func containsString(values []string, want string) bool {
	for _, v := range values {
		if v == want {
			return true
		}
	}
	return false
}
