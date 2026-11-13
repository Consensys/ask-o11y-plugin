package agent

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	mcpsdk "github.com/modelcontextprotocol/go-sdk/mcp"

	"consensys-asko11y-app/pkg/mcp"
)

func testTool(name, description string, params ...string) mcp.Tool {
	props := map[string]interface{}{}
	for _, p := range params {
		props[p] = map[string]interface{}{"type": "string"}
	}
	return mcp.Tool{
		Name:        name,
		Description: description,
		InputSchema: map[string]interface{}{"type": "object", "properties": props},
	}
}

func sampleTools() []mcp.Tool {
	return []mcp.Tool{
		testTool("mcp-grafana_alerting_silences_read", "List or get alert silences so you can mute notifications."),
		testTool("mcp-grafana_alerting_rules_read", "List or get alert rules and their state."),
		testTool("mcp-grafana_query_loki_logs", "Run a LogQL query and return log lines.", "datasourceUid", "query"),
		testTool("mcp-grafana_list_dashboards", "Search dashboards by title."),
		testTool("mcp-grafana_query_prometheus", "Run a PromQL query and return samples.", "datasourceUid", "query"),
		testTool("mcp-grafana_get_annotations", "Read annotations in a time range."),
	}
}

func TestToolIndexRanksByCapability(t *testing.T) {
	idx := NewToolIndex(sampleTools())

	cases := []struct {
		query string
		want  string
	}{
		{"silence an alert", "mcp-grafana_alerting_silences_read"},
		{"loki logs", "mcp-grafana_query_loki_logs"},
		{"dashboards", "mcp-grafana_list_dashboards"},
		{"prometheus samples", "mcp-grafana_query_prometheus"},
		{"annotations", "mcp-grafana_get_annotations"},
	}
	for _, tc := range cases {
		matches := idx.Search(tc.query, 3)
		if len(matches) == 0 {
			t.Fatalf("query %q returned no matches", tc.query)
		}
		if matches[0].Name != tc.want {
			t.Errorf("query %q: expected %q first, got %q (scores %v)", tc.query, tc.want, matches[0].Name, scores(matches))
		}
	}
}

func TestToolIndexOnlyReturnsIndexedTools(t *testing.T) {
	// The loop builds the index from the RBAC-filtered set; a tool that was
	// filtered out must never surface, or search becomes a permission bypass.
	allowed := []mcp.Tool{testTool("mcp-grafana_list_dashboards", "Search dashboards by title.")}
	idx := NewToolIndex(allowed)

	for _, m := range idx.Search("delete dashboard silence", 10) {
		if m.Name != "mcp-grafana_list_dashboards" {
			t.Fatalf("index returned a tool that was not indexed: %s", m.Name)
		}
	}
}

func TestToolIndexDeterministicAndEmptyQuery(t *testing.T) {
	idx := NewToolIndex(sampleTools())
	first := idx.Search("alert", 5)
	second := idx.Search("alert", 5)
	if len(first) != len(second) {
		t.Fatalf("unstable result length: %d vs %d", len(first), len(second))
	}
	for i := range first {
		if first[i].Name != second[i].Name {
			t.Fatalf("unstable order at %d: %s vs %s", i, first[i].Name, second[i].Name)
		}
	}
	if got := idx.Search("   ", 5); got != nil {
		t.Fatalf("empty query should return nothing, got %v", got)
	}
	if got := NewToolIndex(nil).Search("alert", 5); got != nil {
		t.Fatalf("empty index should return nothing, got %v", got)
	}
}

func scores(matches []ToolMatch) []float64 {
	out := make([]float64, 0, len(matches))
	for _, m := range matches {
		out = append(out, m.Score)
	}
	return out
}

func TestToolRuntimeModeSelection(t *testing.T) {
	tools := sampleTools()
	tokens := estimateToolsTokens(ConvertMCPToolsToOpenAI(tools))

	cases := []struct {
		name string
		cfg  ToolSearchConfig
		want bool
	}{
		{"off", ToolSearchConfig{Mode: "off"}, false},
		{"on", ToolSearchConfig{Mode: "on"}, true},
		{"auto below budget", ToolSearchConfig{Mode: "auto", BudgetTokens: tokens + 1}, false},
		{"auto above budget", ToolSearchConfig{Mode: "auto", BudgetTokens: tokens - 1}, true},
		{"zero value is auto", ToolSearchConfig{}, false},
	}
	for _, tc := range cases {
		if got := newToolRuntime(tools, tc.cfg).Enabled(); got != tc.want {
			t.Errorf("%s: enabled=%v, want %v", tc.name, got, tc.want)
		}
	}

	// A single tool is not worth a discovery round trip in auto mode, but an
	// explicit "on" is an admin decision and is honored.
	if newToolRuntime(tools[:1], ToolSearchConfig{Mode: "auto", BudgetTokens: 1}).Enabled() {
		t.Error("auto discovery should stay off with a single tool")
	}
	if !newToolRuntime(tools[:1], ToolSearchConfig{Mode: "on"}).Enabled() {
		t.Error("explicit on should enable discovery")
	}
}

func TestToolRuntimeBatchActivationKeepsBestMatches(t *testing.T) {
	// A batch larger than the cap must drop the weakest matches, not the
	// highest ranked ones: activation order feeds the eviction order.
	tools := sampleTools()
	rt := newToolRuntime(tools, ToolSearchConfig{Mode: "on", MaxActiveTools: 2})

	matches := []ToolMatch{
		{Name: "mcp-grafana_alerting_silences_read", Score: 9},
		{Name: "mcp-grafana_alerting_rules_read", Score: 8},
		{Name: "mcp-grafana_get_annotations", Score: 3},
		{Name: "mcp-grafana_list_dashboards", Score: 2},
	}
	added, evicted := rt.Activate(matches)

	if len(evicted) != 2 {
		t.Fatalf("expected two evictions, got %v (added %v)", evicted, added)
	}
	if len(added) != 2 || added[0] != "mcp-grafana_alerting_silences_read" || added[1] != "mcp-grafana_alerting_rules_read" {
		t.Fatalf("expected the two best matches to survive, got added=%v evicted=%v", added, evicted)
	}
	active := map[string]bool{}
	for _, tool := range rt.activeTools() {
		active[tool.Name] = true
	}
	if !active["mcp-grafana_alerting_silences_read"] || !active["mcp-grafana_alerting_rules_read"] {
		t.Fatalf("best matches were evicted: %v", active)
	}
	if active["mcp-grafana_get_annotations"] || active["mcp-grafana_list_dashboards"] {
		t.Fatalf("weak matches stayed active: %v", active)
	}
}

func TestToolRuntimeActivationAndCaps(t *testing.T) {
	tools := sampleTools()
	rt := newToolRuntime(tools, ToolSearchConfig{Mode: "on", MaxActiveTools: 2})

	names := func() []string {
		out := make([]string, 0)
		for _, tool := range rt.activeTools() {
			out = append(out, tool.Name)
		}
		return out
	}

	added, evicted := rt.Activate([]ToolMatch{{Name: "mcp-grafana_list_dashboards"}})
	if len(added) != 1 || len(evicted) != 0 {
		t.Fatalf("first activation: added=%v evicted=%v", added, evicted)
	}
	// Reactivating an active tool is a no-op.
	added, _ = rt.Activate([]ToolMatch{{Name: "mcp-grafana_list_dashboards"}})
	if len(added) != 0 {
		t.Fatalf("reactivation should not add tools, got %v", added)
	}

	rt.Activate([]ToolMatch{{Name: "mcp-grafana_query_loki_logs"}})
	added, evicted = rt.Activate([]ToolMatch{{Name: "mcp-grafana_get_annotations"}})
	if len(evicted) != 1 || evicted[0] != "mcp-grafana_list_dashboards" {
		t.Fatalf("expected the oldest tool evicted, got %v (added %v)", evicted, added)
	}
	if got := names(); len(got) != 2 || got[0] != "mcp-grafana_query_loki_logs" {
		t.Fatalf("unexpected active set: %v", got)
	}
}

func TestToolRuntimeTokenCapEvicts(t *testing.T) {
	long := strings.Repeat("very long description about dashboards and panels. ", 200)
	tools := []mcp.Tool{
		testTool("mcp-grafana_update_dashboard", long),
		testTool("mcp-grafana_get_dashboard", long),
		testTool("mcp-grafana_list_dashboards", long),
	}
	oneTool := estimateToolsTokens(ConvertMCPToolsToOpenAI(tools[:1]))
	// Budget fits one long definition but not two.
	rt := newToolRuntime(tools, ToolSearchConfig{Mode: "on", ActivationTokenBudget: oneTool + 10})

	rt.Activate([]ToolMatch{{Name: "mcp-grafana_update_dashboard"}})
	if len(rt.active) != 1 {
		t.Fatalf("expected the first activation to land, got %v", rt.active)
	}
	_, evicted := rt.Activate([]ToolMatch{{Name: "mcp-grafana_get_dashboard"}})
	if len(evicted) != 1 || evicted[0] != "mcp-grafana_update_dashboard" {
		t.Fatalf("expected the older definition evicted, got %v", evicted)
	}
	if rt.activeTokens() > rt.cfg.ActivationTokenBudget {
		t.Fatalf("active set exceeds the token budget: %d > %d", rt.activeTokens(), rt.cfg.ActivationTokenBudget)
	}

	// A definition larger than the whole budget still survives, alone: the
	// model must not be left with nothing after a successful search.
	tiny := newToolRuntime(tools, ToolSearchConfig{Mode: "on", ActivationTokenBudget: 1})
	tiny.Activate([]ToolMatch{{Name: "mcp-grafana_update_dashboard"}})
	if len(tiny.active) != 1 {
		t.Fatalf("a single oversized definition should still activate, got %v", tiny.active)
	}
}

func TestToolRuntimeAlwaysInclude(t *testing.T) {
	tools := sampleTools()
	rt := newToolRuntime(tools, ToolSearchConfig{
		Mode:          "on",
		AlwaysInclude: []string{"mcp-grafana_get_annotations", "mcp-grafana_query_loki_logs"},
	})
	pinned := make([]string, 0)
	for _, tool := range rt.pinnedTools() {
		pinned = append(pinned, tool.Name)
	}
	if len(pinned) != 2 {
		t.Fatalf("expected 2 pinned tools, got %v", pinned)
	}

	// A pattern entry pins every match.
	patternPinned := newToolRuntime(tools, ToolSearchConfig{
		Mode:          "on",
		AlwaysInclude: []string{"mcp-grafana_query_*"},
	})
	if got := len(patternPinned.pinnedTools()); got != 2 {
		t.Fatalf("pattern should pin both query tools, got %d", got)
	}

	// Pinned tools are not evicted and not re-added by search.
	rt = newToolRuntime(tools, ToolSearchConfig{
		Mode:           "on",
		MaxActiveTools: 1,
		AlwaysInclude:  []string{"mcp-grafana_get_annotations"},
	})
	rt.Activate([]ToolMatch{{Name: "mcp-grafana_list_dashboards"}})
	_, evicted := rt.Activate([]ToolMatch{{Name: "mcp-grafana_query_loki_logs"}})
	for _, name := range evicted {
		if name == "mcp-grafana_get_annotations" {
			t.Fatalf("pinned tool was evicted: %v", evicted)
		}
	}
	found := false
	for _, tool := range rt.OpenAITools() {
		if tool.Function.Name == "mcp-grafana_get_annotations" {
			found = true
		}
	}
	if !found {
		t.Fatal("pinned tool missing from the request tool list")
	}
}

func TestToolRuntimeCatalogMentionsServers(t *testing.T) {
	rt := newToolRuntime(sampleTools(), ToolSearchConfig{Mode: "on"})
	catalog := rt.Catalog()
	if !strings.Contains(catalog, "mcp-grafana") || !strings.Contains(catalog, "search_tools") {
		t.Fatalf("catalog does not describe the servers or the meta-tool: %q", catalog)
	}
	if off := newToolRuntime(sampleTools(), ToolSearchConfig{Mode: "off"}).Catalog(); off != "" {
		t.Fatalf("catalog should be empty when discovery is off, got %q", off)
	}
}

func TestAgentLoopToolSearchActivatesTools(t *testing.T) {
	var mu sync.Mutex
	var bodies []ChatCompletionRequest
	repeatedSearch := false

	llmServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body ChatCompletionRequest
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Errorf("decode request: %v", err)
			return
		}
		// Auxiliary calls (eviction summaries, final-report checks) carry no
		// tools; answer them with prose so they never disturb the state
		// machine below.
		if len(body.Tools) == 0 {
			respondAsStream(w, ChatCompletionResponse{
				ID:      "aux",
				Choices: []Choice{{Message: Message{Role: "assistant", Content: "ok"}, FinishReason: "stop"}},
			})
			return
		}

		mu.Lock()
		bodies = append(bodies, body)
		mu.Unlock()

		last := body.Messages[len(body.Messages)-1]
		switch {
		case last.Role == "user":
			respondAsStream(w, toolCallResponse("search_tools", `{"query":"read the thing"}`))
		case strings.Contains(last.Content, "thing value"):
			respondAsStream(w, ChatCompletionResponse{
				ID: "3",
				Choices: []Choice{{
					Message:      Message{Role: "assistant", Content: "all done"},
					FinishReason: "stop",
				}},
			})
		case strings.Contains(last.Content, "activated") && !repeatedSearch:
			// Repeat the identical search once: meta-tools must re-execute
			// rather than be served from the stall cache.
			mu.Lock()
			repeatedSearch = true
			mu.Unlock()
			respondAsStream(w, toolCallResponse("search_tools", `{"query":"read the thing"}`))
		default:
			respondAsStream(w, toolCallResponse("fake_get_thing", `{}`))
		}
	}))
	defer llmServer.Close()

	loop := NewAgentLoop(
		NewLLMClient(log.DefaultLogger, &http.Client{Timeout: llmTimeout}),
		mcp.NewProxy(context.Background(), log.DefaultLogger),
		log.DefaultLogger,
	)
	setupFakeMCP(t, loop, func(srv *mcpsdk.Server) {
		srv.AddTool(&mcpsdk.Tool{
			Name:        "get_thing",
			Description: "Read the thing from the store.",
			InputSchema: map[string]any{"type": "object"},
		}, func(ctx context.Context, req *mcpsdk.CallToolRequest) (*mcpsdk.CallToolResult, error) {
			return sdkToolResult("thing value", false), nil
		})
	})

	eventCh := make(chan SSEEvent, 64)
	req := LoopRequest{
		Messages:     []Message{{Role: "user", Content: "read the thing"}},
		SystemPrompt: "sys",
		GrafanaURL:   llmServer.URL,
		AuthToken:    "test-token",
		UserRole:     "Admin",
		OrgID:        "1",
		ToolSearch:   ToolSearchConfig{Mode: "on"},
	}
	go loop.Run(context.Background(), req, eventCh)
	events := collectEvents(eventCh)

	assertToolsActivatedEvent(t, events, "fake_get_thing")

	mu.Lock()
	defer mu.Unlock()
	if len(bodies) < 4 {
		t.Fatalf("expected 4 LLM calls (search, repeated search, tool, answer), got %d", len(bodies))
	}

	searchResults := 0
	for _, message := range bodies[len(bodies)-1].Messages {
		if message.Role == "tool" && strings.Contains(message.Content, "activated") {
			searchResults++
		}
	}
	if searchResults < 2 {
		t.Fatalf("repeated search did not execute again: %d search results in history", searchResults)
	}

	first := toolNames(bodies[0])
	if !containsName(first, searchToolsToolName) {
		t.Errorf("first request should advertise search_tools, got %v", first)
	}
	if containsName(first, "fake_get_thing") {
		t.Errorf("first request should not send every definition, got %v", first)
	}
	if !hasCatalogMessage(bodies[0]) {
		t.Error("first request should carry the tool catalog system message")
	}

	second := toolNames(bodies[1])
	if !containsName(second, "fake_get_thing") {
		t.Errorf("activated tool missing from the second request: %v", second)
	}

	// A repeated search must execute again: replaying a cached result would
	// skip activation and leave the model without the tools it asked for.
	for _, body := range bodies {
		for _, message := range body.Messages {
			if strings.Contains(message.Content, "identical call already executed") {
				t.Errorf("meta-tool was replayed from the stall cache: %q", message.Content)
			}
		}
	}

	// Meta-tools produce no evidence: they return no data and would pollute
	// the evidence list and the final-report citation set.
	for _, event := range events {
		if event.Type != "evidence" {
			continue
		}
		data, ok := event.Data.(EvidenceEvent)
		if !ok {
			continue
		}
		if isMetaTool(data.ToolName) {
			t.Errorf("meta-tool %q produced an evidence event", data.ToolName)
		}
	}
}

// assertToolsActivatedEvent checks that the run reported the activation to the
// UI with the given tool name.
func assertToolsActivatedEvent(t *testing.T, events []SSEEvent, wantTool string) {
	t.Helper()
	for _, event := range events {
		if event.Type != "tools_activated" {
			continue
		}
		data, ok := event.Data.(ToolsActivatedEvent)
		if !ok {
			t.Fatalf("tools_activated carried unexpected payload type %T", event.Data)
		}
		if len(data.Tools) == 0 {
			t.Fatalf("tools_activated event carried no tools")
		}
		for _, tool := range data.Tools {
			if tool.Name == wantTool {
				return
			}
		}
		t.Fatalf("tools_activated did not include %q: %+v", wantTool, data.Tools)
	}
	t.Fatalf("no tools_activated event emitted; got %d events", len(events))
}

func toolCallResponse(name, args string) ChatCompletionResponse {
	return ChatCompletionResponse{
		ID: "call-" + name,
		Choices: []Choice{{
			Message: Message{
				Role: "assistant",
				ToolCalls: []ToolCall{{
					ID:       "call_1",
					Type:     "function",
					Function: FunctionCall{Name: name, Arguments: args},
				}},
			},
			FinishReason: "tool_calls",
		}},
	}
}

func toolNames(req ChatCompletionRequest) []string {
	out := make([]string, 0, len(req.Tools))
	for _, t := range req.Tools {
		out = append(out, t.Function.Name)
	}
	return out
}

func containsName(names []string, want string) bool {
	for _, n := range names {
		if n == want {
			return true
		}
	}
	return false
}

func hasCatalogMessage(req ChatCompletionRequest) bool {
	for _, m := range req.Messages {
		if m.Role == "system" && strings.Contains(m.Content, "Tool discovery is enabled") {
			return true
		}
	}
	return false
}

func TestRequiredToolFields(t *testing.T) {
	tool := mcp.Tool{InputSchema: map[string]interface{}{
		"type":     "object",
		"required": []interface{}{"operation", "title", "rule_group"},
	}}
	got := requiredToolFields(tool)
	if len(got) != 3 || got[0] != "operation" || got[2] != "rule_group" {
		t.Fatalf("requiredToolFields = %v, want the schema order", got)
	}
	if got := requiredToolFields(mcp.Tool{}); got != nil {
		t.Fatalf("requiredToolFields(nil schema) = %v, want nil", got)
	}
}

func TestLateActivationDirectiveCarriesSchema(t *testing.T) {
	tool := testTool("mcp-grafana_alerting_rules_write", "Create rules.", "operation", "title", "rule_group")
	tool.InputSchema["required"] = []string{"operation", "title", "rule_group"}

	msg := lateActivationDirective(tool)
	for _, want := range []string{"was not executed", "rule_group", "Re-issue the call"} {
		if !strings.Contains(msg, want) {
			t.Fatalf("directive missing %q: %s", want, msg)
		}
	}
}
