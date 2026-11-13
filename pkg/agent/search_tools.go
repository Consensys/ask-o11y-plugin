package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"consensys-asko11y-app/pkg/mcp"
)

// On-demand tool discovery.
//
// Every MCP server declared by an admin adds its tool definitions to the
// prompt, and the definition text is re-sent on each LLM request. With the
// grafana-llm-app built-in server alone that is ~25k tokens, which crowds out
// conversation history and duplicates itself in every cache-miss.
//
// When discovery is on, the loop sends only a small core set plus the
// search_tools meta-tool. The model calls search_tools with a capability
// query, the matched definitions are activated for the rest of the run, and
// the next iteration sends them as normal tools. Activated tools are real
// tool names, so approval gates, RBAC checks, and tool-call logging behave
// exactly as before.

const (
	searchToolsToolName = "search_tools"

	// DefaultToolSearchBudgetTokens is the definition-token count above which
	// auto mode switches from "send everything" to on-demand discovery. Below
	// it, the saving does not pay for the extra model turn.
	DefaultToolSearchBudgetTokens = 6000
	// DefaultMaxActiveTools caps how many activated definitions a run may
	// carry. Each one costs prompt budget on every later request.
	DefaultMaxActiveTools = 24
	// DefaultActivationTokenBudget caps the same thing in tokens, so a few
	// very large definitions (update_dashboard is ~1.2k tokens) cannot fill
	// the window on their own.
	DefaultActivationTokenBudget = 12000

	defaultSearchToolsResults = 8
	maxSearchToolsResults     = 25

	// searchToolsDescriptionChars keeps each activated description short; the
	// model needs enough to choose the tool, not the full prose.
	searchToolsDescriptionChars = 240
)

// ToolSearchConfig is the admin-facing on-demand tool discovery setting,
// stored in plugin jsonData under "toolSearch".
type ToolSearchConfig struct {
	// Mode is "off" (always send every tool), "auto" (discover when the
	// definitions exceed BudgetTokens), or "on" (always discover).
	Mode string `json:"mode,omitempty"`
	// BudgetTokens is the definition-token threshold used by auto mode.
	BudgetTokens int `json:"budgetTokens,omitempty"`
	// MaxActiveTools and ActivationTokenBudget cap the activated set.
	MaxActiveTools        int `json:"maxActiveTools,omitempty"`
	ActivationTokenBudget int `json:"activationTokenBudget,omitempty"`
	// AlwaysInclude lists tool names or "prefix_*" patterns that bypass
	// discovery and are always sent, e.g. "mcp-grafana_search_dashboards".
	AlwaysInclude []string `json:"alwaysInclude,omitempty"`
}

// withDefaults resolves the zero value to auto mode with the shipped caps, so
// an install that never sets the field still gets the saving.
func (c ToolSearchConfig) withDefaults() ToolSearchConfig {
	switch c.Mode {
	case "off", "auto", "on":
	default:
		c.Mode = "auto"
	}
	if c.BudgetTokens <= 0 {
		c.BudgetTokens = DefaultToolSearchBudgetTokens
	}
	if c.MaxActiveTools <= 0 {
		c.MaxActiveTools = DefaultMaxActiveTools
	}
	if c.ActivationTokenBudget <= 0 {
		c.ActivationTokenBudget = DefaultActivationTokenBudget
	}
	return c
}

// toolRuntime owns the per-run discovery state: the index over the filtered
// tool set and the activated names. It is created inside Run and shared with
// the tool executors through LoopRequest.toolRuntime.
type toolRuntime struct {
	tools    []mcp.Tool
	byName   map[string]mcp.Tool
	index    *ToolIndex
	cfg      ToolSearchConfig
	enabled  bool
	always   []string
	active   []string
	activeIn map[string]bool
}

// newToolRuntime decides whether discovery is on for this run. The index is
// built from the caller's already-filtered tools: RBAC and per-server
// selection run before this point, so a tool the user cannot call is never
// searchable.
func newToolRuntime(tools []mcp.Tool, cfg ToolSearchConfig) *toolRuntime {
	cfg = cfg.withDefaults()
	rt := &toolRuntime{
		tools:    tools,
		byName:   make(map[string]mcp.Tool, len(tools)),
		index:    NewToolIndex(tools),
		cfg:      cfg,
		activeIn: make(map[string]bool),
	}
	for _, t := range tools {
		rt.byName[t.Name] = t
	}
	rt.always = matchToolPatterns(tools, cfg.AlwaysInclude)

	switch cfg.Mode {
	case "off":
		return rt
	case "on":
		rt.enabled = true
	default:
		rt.enabled = estimateToolsTokens(ConvertMCPToolsToOpenAI(tools)) > cfg.BudgetTokens
		// Discovery with nothing to discover only costs a model turn, so auto
		// mode stays off when the catalog is already tiny.
		if rt.enabled && len(tools) <= len(rt.always)+1 {
			rt.enabled = false
		}
	}
	return rt
}

// Enabled reports whether the run uses discovery.
func (rt *toolRuntime) Enabled() bool {
	return rt != nil && rt.enabled
}

// OpenAITools returns the tool definitions for the next request: the whole set
// when discovery is off, otherwise the core set plus the activated tools.
func (rt *toolRuntime) OpenAITools() []OpenAITool {
	if !rt.enabled {
		return ConvertMCPToolsToOpenAI(rt.tools)
	}
	out := make([]OpenAITool, 0, len(rt.always)+len(rt.active)+1)
	out = append(out, searchToolsSpec())
	out = append(out, ConvertMCPToolsToOpenAI(rt.pinnedTools())...)
	out = append(out, ConvertMCPToolsToOpenAI(rt.activeTools())...)
	return out
}

func (rt *toolRuntime) pinnedTools() []mcp.Tool {
	out := make([]mcp.Tool, 0, len(rt.always))
	for _, name := range rt.always {
		if t, ok := rt.byName[name]; ok {
			out = append(out, t)
		}
	}
	return out
}

func (rt *toolRuntime) activeTools() []mcp.Tool {
	out := make([]mcp.Tool, 0, len(rt.active))
	for _, name := range rt.active {
		if t, ok := rt.byName[name]; ok {
			out = append(out, t)
		}
	}
	return out
}

// Activate adds the matched tools to the run set, evicting the least recently
// activated tools when a cap is reached. It returns the names added and the
// names evicted so the tool result can tell the model what happened.
func (rt *toolRuntime) Activate(matches []ToolMatch) (added, evicted []string) {
	if !rt.enabled {
		return nil, nil
	}
	pinned := make(map[string]bool, len(rt.always))
	for _, name := range rt.always {
		pinned[name] = true
	}
	candidates := make([]string, 0, len(matches))
	for _, match := range matches {
		name := match.Name
		if pinned[name] || rt.activeIn[name] {
			continue
		}
		if _, ok := rt.byName[name]; !ok {
			continue
		}
		candidates = append(candidates, name)
	}
	if len(candidates) == 0 {
		return nil, nil
	}
	// Append the weakest match first: enforceCaps evicts from the front of the
	// active list, so a batch larger than the caps drops the lowest ranked
	// matches and keeps the best ones.
	for i := len(candidates) - 1; i >= 0; i-- {
		name := candidates[i]
		rt.active = append(rt.active, name)
		rt.activeIn[name] = true
	}
	evicted = rt.enforceCaps(pinned)
	dropped := make(map[string]bool, len(evicted))
	for _, name := range evicted {
		dropped[name] = true
	}
	for _, name := range candidates {
		if !dropped[name] {
			added = append(added, name)
		}
	}
	return added, evicted
}

// enforceCaps evicts the oldest activated tools until both the count and the
// token caps hold. Pinned tools are never evicted, and the newest activation
// always survives: returning nothing because one definition is larger than
// the whole budget would leave the model without a way forward.
func (rt *toolRuntime) enforceCaps(pinned map[string]bool) []string {
	var evicted []string
	for len(rt.active) > rt.cfg.MaxActiveTools && len(rt.active) > 1 {
		if !rt.evictOldest(pinned, &evicted) {
			break
		}
	}
	for rt.activeTokens() > rt.cfg.ActivationTokenBudget && len(rt.active) > 1 {
		if !rt.evictOldest(pinned, &evicted) {
			break
		}
	}
	return evicted
}

func (rt *toolRuntime) evictOldest(pinned map[string]bool, evicted *[]string) bool {
	for i, name := range rt.active {
		if pinned[name] {
			continue
		}
		rt.active = append(rt.active[:i], rt.active[i+1:]...)
		delete(rt.activeIn, name)
		*evicted = append(*evicted, name)
		return true
	}
	return false
}

func (rt *toolRuntime) activeTokens() int {
	return estimateToolsTokens(ConvertMCPToolsToOpenAI(rt.activeTools()))
}

// Catalog is the short system-prompt block that tells the model discovery is
// on and what servers exist. It replaces ~25k tokens of definitions with a
// few dozen.
func (rt *toolRuntime) Catalog() string {
	if !rt.enabled {
		return ""
	}
	servers := map[string][]string{}
	for _, t := range rt.tools {
		server := t.Name
		if idx := strings.Index(t.Name, "_"); idx > 0 {
			server = t.Name[:idx]
		}
		servers[server] = append(servers[server], t.Name)
	}
	keys := make([]string, 0, len(servers))
	for k := range servers {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	var b strings.Builder
	b.WriteString("Tool discovery is enabled to keep this context small: only a few tool definitions are sent per request.\n")
	b.WriteString("Tool servers: ")
	for i, key := range keys {
		names := servers[key]
		examples := names
		if len(examples) > 3 {
			examples = examples[:3]
		}
		if i > 0 {
			b.WriteString("; ")
		}
		fmt.Fprintf(&b, "%s (%d tools, e.g. %s)", key, len(names), strings.Join(examples, ", "))
	}
	b.WriteString(".\nCall search_tools with a short capability query (for example \"silence an alert\", " +
		"\"slow traces\", \"create a dashboard\") to load the definitions you need. Loaded tools become " +
		"callable on your next turn.")
	return b.String()
}

// searchToolsSpec is the meta-tool definition. It is written to discourage a
// single vague query and to ask for one capability at a time.
func searchToolsSpec() OpenAITool {
	return OpenAITool{
		Type: "function",
		Function: OpenAIFunction{
			Name: searchToolsToolName,
			Description: "Search the connected MCP tool catalog and activate matching tools. " +
				"Use a short capability query (\"silence an alert\", \"query loki logs\", \"create a dashboard\"). " +
				"The matched tools become callable on your next turn; then call them directly with their real arguments.",
			Parameters: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"query": map[string]interface{}{
						"type":        "string",
						"description": "What you want to do, in a few words. Prefer one capability per call.",
					},
					"limit": map[string]interface{}{
						"type":        "integer",
						"description": fmt.Sprintf("Maximum number of tools to activate (default %d, max %d).", defaultSearchToolsResults, maxSearchToolsResults),
					},
				},
				"required": []string{"query"},
			},
		},
	}
}

// searchToolsResult is the JSON payload returned to the model. Descriptions
// are truncated: the model needs to recognize the tool, not read its manual.
type searchToolsResult struct {
	Activated     []activatedTool `json:"activated"`
	AlreadyActive []string        `json:"already_active,omitempty"`
	Evicted       []string        `json:"evicted,omitempty"`
	Message       string          `json:"message"`
}

type activatedTool struct {
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
}

// requiredToolFields returns the parameter names listed under "required" in
// the tool's input schema.
func requiredToolFields(t mcp.Tool) []string {
	if t.InputSchema == nil {
		return nil
	}
	raw, ok := t.InputSchema["required"]
	if !ok {
		return nil
	}
	switch v := raw.(type) {
	case []string:
		return v
	case []interface{}:
		out := make([]string, 0, len(v))
		for _, item := range v {
			if s, ok := item.(string); ok {
				out = append(out, s)
			}
		}
		return out
	}
	return nil
}

// lateActivationDirective tells the model that a tool it just named was not
// part of the request it answered, and gives it the full definition.
func lateActivationDirective(t mcp.Tool) string {
	schema, err := json.Marshal(t.InputSchema)
	if err != nil {
		schema = []byte("{}")
	}
	return fmt.Sprintf("[SYSTEM: '%s' was not available in the request that named it, so the call was not executed. It is active now. Re-issue the call with arguments that match this schema: %s]", t.Name, schema)
}

// ToolsActivatedEvent tells the UI which tools a search_tools call made
// available, so the user can see the discovery step.
type ToolsActivatedEvent struct {
	Query   string          `json:"query,omitempty"`
	Tools   []activatedTool `json:"tools"`
	Evicted []string        `json:"evicted,omitempty"`
}

// executeSearchTools serves the internal search_tools call and records the
// activation on the run runtime.
func (a *AgentLoop) executeSearchTools(ctx context.Context, eventCh chan<- SSEEvent, tc ToolCall, req LoopRequest) (string, bool, string) {
	rt := req.toolRuntime
	if rt == nil || !rt.Enabled() {
		return "Tool discovery is not enabled for this run; call the tools directly by name.", true, "tool"
	}
	var args struct {
		Query string `json:"query"`
		Limit int    `json:"limit"`
	}
	if err := json.Unmarshal([]byte(tc.Function.Arguments), &args); err != nil {
		return fmt.Sprintf("Invalid search_tools arguments: %v", err), true, "tool"
	}
	if strings.TrimSpace(args.Query) == "" {
		return "search_tools requires a 'query' argument", true, "tool"
	}

	matches := rt.index.Search(args.Query, args.Limit)
	if len(matches) == 0 {
		return mustJSON(searchToolsResult{
			Message: "No tool matched. Try a broader capability query (for example \"dashboard\", \"alerting\", \"logs\", \"traces\").",
		}), false, ""
	}

	added, evicted := rt.Activate(matches)
	res := searchToolsResult{Evicted: evicted}
	addedSet := make(map[string]bool, len(added))
	for _, name := range added {
		addedSet[name] = true
	}
	event := ToolsActivatedEvent{Query: args.Query, Evicted: evicted}
	for _, match := range matches {
		if !rt.activeIn[match.Name] {
			continue
		}
		if addedSet[match.Name] {
			info := activatedTool{
				Name:        match.Name,
				Description: truncateText(match.Description, searchToolsDescriptionChars),
			}
			// A 240-char description cannot carry an 11-field schema, and the
			// model may call the tool in the same turn it was activated. Name
			// the required fields so a call made before the full definition
			// arrives still has a chance to be well formed.
			if required := requiredToolFields(match.Tool); len(required) > 0 {
				info.Description += " Required: " + strings.Join(required, ", ")
			}
			res.Activated = append(res.Activated, info)
			event.Tools = append(event.Tools, info)
			continue
		}
		res.AlreadyActive = append(res.AlreadyActive, match.Name)
	}
	if len(event.Tools) > 0 {
		a.send(ctx, eventCh, SSEEvent{Type: "tools_activated", Data: event})
	}
	switch {
	case len(res.Activated) > 0:
		res.Message = "These tools are now available; call them directly on your next turn."
	default:
		res.Message = "The matching tools were already active; call them directly."
	}
	a.logger.Debug("Tool search",
		"query", args.Query,
		"activated", strings.Join(added, ","),
		"evicted", strings.Join(evicted, ","),
		"active", len(rt.active))
	return mustJSON(res), false, ""
}

func mustJSON(v interface{}) string {
	b, err := json.Marshal(v)
	if err != nil {
		return fmt.Sprintf(`{"message":"failed to encode result: %v"}`, err)
	}
	return string(b)
}

// estimateToolsTokens counts only the tool definitions, using the same
// estimator the context-window trimming uses.
func estimateToolsTokens(tools []OpenAITool) int {
	return estimateMessagesTokens(nil, tools)
}

// matchToolPatterns resolves AlwaysInclude entries. An entry matches a tool by
// exact name or by a trailing "*" prefix ("mcp-grafana_search_*").
func matchToolPatterns(tools []mcp.Tool, patterns []string) []string {
	if len(patterns) == 0 {
		return nil
	}
	seen := make(map[string]bool, len(patterns))
	var out []string
	for _, pattern := range patterns {
		pattern = strings.TrimSpace(pattern)
		if pattern == "" {
			continue
		}
		for _, t := range tools {
			matched := t.Name == pattern
			if !matched && strings.HasSuffix(pattern, "*") {
				matched = strings.HasPrefix(t.Name, strings.TrimSuffix(pattern, "*"))
			}
			if matched && !seen[t.Name] {
				seen[t.Name] = true
				out = append(out, t.Name)
			}
		}
	}
	sort.Strings(out)
	return out
}

// injectSystemContext inserts a system message right after the leading system
// prompt, keeping the catalog adjacent to the instructions it qualifies.
func injectSystemContext(messages []Message, text string) []Message {
	block := Message{Role: "system", Content: text}
	if len(messages) > 0 && messages[0].Role == "system" {
		out := make([]Message, 0, len(messages)+1)
		out = append(out, messages[0], block)
		return append(out, messages[1:]...)
	}
	return append([]Message{block}, messages...)
}

func truncateText(text string, max int) string {
	text = strings.TrimSpace(text)
	if max <= 0 || len(text) <= max {
		return text
	}
	cut := text[:max]
	if idx := strings.LastIndex(cut, " "); idx > max/2 {
		cut = cut[:idx]
	}
	return cut + "…"
}
