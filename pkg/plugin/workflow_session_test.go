package plugin

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"consensys-asko11y-app/pkg/agent"
	"consensys-asko11y-app/pkg/mcp"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	"github.com/prometheus/client_golang/prometheus/testutil"
)

// stubLLMFinalAnswer serves one SSE exchange that ends the run with a plain
// final answer: a content delta, a stop finish reason with usage, then DONE.
func stubLLMFinalAnswer(text string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprintf(w, "data: {\"choices\":[{\"delta\":{\"content\":%q}}]}\n\n", text)
		fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":10,\"completion_tokens\":5,\"total_tokens\":15}}\n\n")
		fmt.Fprint(w, "data: [DONE]\n\n")
	}
}

// stubLLMHanging stalls until the request context dies or a hard ceiling
// passes, so the watchdog is the only thing that can end the session. The
// ceiling matters: a client-side cancel of a body-carrying POST does not
// tear the connection down (Go stdlib behavior), so the handler must end
// on its own for the test server to close.
func stubLLMHanging() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-r.Context().Done():
		case <-time.After(5 * time.Second):
		}
	}
}

// newWorkflowTestPlugin builds a white-box plugin whose LLM traffic goes to
// the given handler, and returns the plugin plus the stub Grafana URL to put
// in workflowRunParams.
func newWorkflowTestPlugin(t *testing.T, llmHandler http.HandlerFunc) (*Plugin, string) {
	t.Helper()

	logger := log.DefaultLogger
	proxy := mcp.NewProxy(context.Background(), logger)
	llmServer := httptest.NewServer(llmHandler)
	t.Cleanup(llmServer.Close)

	promptRegistry, err := NewPromptRegistry(PluginSettings{})
	if err != nil {
		t.Fatalf("NewPromptRegistry failed: %v", err)
	}
	// Bounded client: an abandoned LLM connection must close eventually so
	// the stub server can shut down (see stubLLMHanging).
	llmHTTP := llmServer.Client()
	llmHTTP.Timeout = 10 * time.Second
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)

	p := &Plugin{
		logger:         logger,
		mcpProxy:       proxy,
		agentLoop:      agent.NewAgentLoop(agent.NewLLMClient(logger, llmHTTP), proxy, logger),
		runStore:       NewRunStore(logger),
		sessionStore:   NewSessionStore(logger, resolveTTLDays(0, DefaultSessionTTLDays)),
		shareStore:     NewShareStore(logger, NewInMemoryRateLimiter(logger)),
		promptRegistry: promptRegistry,
		skillRegistry:  workflowTestRegistry("dispatch", "investigate", "escalate"),
		orgIdentity:    NewOrgIdentityStore(),
		workflowStatus: NewWorkflowStatusStore(),
		settings: PluginSettings{
			MaxTotalTokens:     agent.DefaultMaxTotalTokens,
			RecentMessageCount: 10,
		},
		ctx:        ctx,
		cancel:     cancel,
		runCancels: make(map[string]context.CancelFunc),
	}
	return p, llmServer.URL
}

func waitForCondition(t *testing.T, timeout time.Duration, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", what)
}

func runStatus(p *Plugin, runID string) RunStatus {
	run, err := p.runStore.GetRun(runID)
	if err != nil {
		return ""
	}
	return run.Status
}

// TestWorkflowSessionRunsPersistsAndCompletes is the US1 integration: a tick
// session produces persisted, tagged session and run records and completes.
func TestWorkflowSessionRunsPersistsAndCompletes(t *testing.T) {
	p, grafanaURL := newWorkflowTestPlugin(t, stubLLMFinalAnswer("triage complete"))

	entry := validWorkflowEntry()
	entry.Name = "happy-wf"
	entry.Skill = "dispatch"
	entry.SessionTimeoutSeconds = 60

	syntheticID := syntheticWorkflowUserID("happy-wf")
	sessionID, runID, err := p.startWorkflowSession(workflowRunParams{
		entry:       entry,
		skill:       "dispatch",
		message:     "Sweep the queue.",
		grafanaURL:  grafanaURL,
		saToken:     "test-token",
		syntheticID: syntheticID,
	})
	if err != nil {
		t.Fatalf("session start failed: %v", err)
	}

	waitForCondition(t, 15*time.Second, "run completion", func() bool {
		return runStatus(p, runID) == RunStatusCompleted
	})

	session, err := p.sessionStore.GetSession(sessionID, syntheticID, entry.OrgID)
	if err != nil {
		t.Fatalf("session record missing: %v", err)
	}
	if session.ConversationType != workflowConversationType {
		t.Fatalf("session not tagged as workflow: %q", session.ConversationType)
	}
	if session.Workflow != "happy-wf" {
		t.Fatalf("session not tagged with workflow name: %q", session.Workflow)
	}
	if len(session.Messages) < 2 {
		t.Fatalf("expected the user message and the assistant answer, got %d", len(session.Messages))
	}

	if got := testutil.ToFloat64(workflowSessions.WithLabelValues("happy-wf", "completed")); got < 1 {
		t.Fatalf("completed metric not counted: %v", got)
	}
	if got := testutil.ToFloat64(workflowSessions.WithLabelValues("happy-wf", "started")); got < 1 {
		t.Fatalf("started metric not counted: %v", got)
	}
}

// TestWorkflowSessionWatchdogCancelsHungSession is the US3 integration: a
// session that never gets an LLM answer is cancelled at its timeout, marked
// failed with the timeout message, and counted as a timeout.
func TestWorkflowSessionWatchdogCancelsHungSession(t *testing.T) {
	p, grafanaURL := newWorkflowTestPlugin(t, stubLLMHanging())

	entry := validWorkflowEntry()
	entry.Name = "hung-wf"
	entry.Skill = "dispatch"
	entry.SessionTimeoutSeconds = 1 // below the config floor on purpose: direct construction

	syntheticID := syntheticWorkflowUserID("hung-wf")
	_, runID, err := p.startWorkflowSession(workflowRunParams{
		entry:       entry,
		skill:       "dispatch",
		message:     "Sweep the queue.",
		grafanaURL:  grafanaURL,
		saToken:     "test-token",
		syntheticID: syntheticID,
	})
	if err != nil {
		t.Fatalf("session start failed: %v", err)
	}

	waitForCondition(t, 15*time.Second, "watchdog timeout", func() bool {
		return runStatus(p, runID) == RunStatusFailed
	})
	run, err := p.runStore.GetRun(runID)
	if err != nil {
		t.Fatalf("run record missing: %v", err)
	}
	if !strings.Contains(run.Error, "timeout") {
		t.Fatalf("failure must name the timeout, got %q", run.Error)
	}
	if got := testutil.ToFloat64(workflowSessions.WithLabelValues("hung-wf", "timeout")); got < 1 {
		t.Fatalf("timeout metric not counted: %v", got)
	}
}

// TestWorkflowFallbackRunsOnceAfterTimeout verifies the fallback skill runs
// exactly once after a timed-out session, and never chains further.
func TestWorkflowFallbackRunsOnceAfterTimeout(t *testing.T) {
	p, grafanaURL := newWorkflowTestPlugin(t, stubLLMHanging())

	entry := validWorkflowEntry()
	entry.Name = "fallback-wf"
	entry.Skill = "dispatch"
	entry.SessionTimeoutSeconds = 1
	entry.FallbackSkill = "escalate"

	syntheticID := syntheticWorkflowUserID("fallback-wf")
	_, _, err := p.startWorkflowSession(workflowRunParams{
		entry:       entry,
		skill:       "dispatch",
		message:     "Sweep the queue.",
		grafanaURL:  grafanaURL,
		saToken:     "test-token",
		syntheticID: syntheticID,
	})
	if err != nil {
		t.Fatalf("session start failed: %v", err)
	}

	// The fallback session itself times out too (same hanging LLM), but must
	// not spawn another fallback: exactly two sessions for this workflow.
	waitForCondition(t, 20*time.Second, "fallback session", func() bool {
		sessions, err := p.sessionStore.ListSessions(syntheticID, entry.OrgID)
		return err == nil && len(sessions) == 2
	})
	sessions, err := p.sessionStore.ListSessions(syntheticID, entry.OrgID)
	if err != nil {
		t.Fatalf("session list failed: %v", err)
	}
	if len(sessions) != 2 {
		t.Fatalf("a timed-out fallback must not chain, got %d sessions", len(sessions))
	}
	foundFallback := false
	for _, s := range sessions {
		if strings.Contains(s.Title, "escalate") {
			foundFallback = true
		}
	}
	if !foundFallback {
		t.Fatalf("fallback session not found: %v", sessions)
	}
}

func TestBuildWorkflowInternalToolsScoping(t *testing.T) {
	p, _ := newWorkflowTestPlugin(t, stubLLMFinalAnswer("ok"))

	entry := validWorkflowEntry()
	entry.SpawnableSkills = []string{"investigate"}
	params := workflowRunParams{entry: entry, syntheticID: 1}

	top := p.buildWorkflowInternalTools(params, "sess-1", "run-1")
	if len(top) != 2 {
		t.Fatalf("top-level dispatcher session must get share and spawn tools, got %d", len(top))
	}

	spawned := params
	spawned.spawned = true
	if got := p.buildWorkflowInternalTools(spawned, "sess-2", "run"); len(got) != 1 {
		t.Fatalf("spawned session must get only the share tool, got %d", len(got))
	}

	fallback := params
	fallback.isFallback = true
	if got := p.buildWorkflowInternalTools(fallback, "sess-3", "run"); len(got) != 1 {
		t.Fatalf("fallback session must never spawn, got %d tools", len(got))
	}

	noSpawn := params
	noSpawn.entry.SpawnableSkills = nil
	if got := p.buildWorkflowInternalTools(noSpawn, "sess-4", "run"); len(got) != 1 {
		t.Fatalf("workflow without spawnable skills must not offer spawn, got %d", len(got))
	}
}

func TestWorkflowSpawnRefusals(t *testing.T) {
	p, grafanaURL := newWorkflowTestPlugin(t, stubLLMFinalAnswer("ok"))

	entry := validWorkflowEntry()
	entry.Name = "spawn-wf"
	entry.SpawnableSkills = []string{"investigate"}
	entry.MaxConcurrentSessions = 1
	params := workflowRunParams{
		entry:       entry,
		grafanaURL:  grafanaURL,
		saToken:     "test-token",
		syntheticID: syntheticWorkflowUserID("spawn-wf"),
	}

	cases := []struct {
		name string
		args string
		want string
	}{
		{"bad json", "not json", "Invalid spawn_session arguments"},
		{"missing skill", `{}`, "requires 'skill' and 'message'"},
		{"not spawnable", `{"skill":"dispatch","message":"x"}`, "not spawnable"},
	}
	for _, tc := range cases {
		content, isErr := p.handleWorkflowSpawn(params, tc.args, entry.SpawnableSkills)
		if !isErr {
			t.Errorf("%s: refusal expected, got %q", tc.name, content)
			continue
		}
		if !strings.Contains(content, tc.want) {
			t.Errorf("%s: message must contain %q, got %q", tc.name, tc.want, content)
		}
	}

	// Without Redis the concurrency check is unavailable: the spawn fails
	// loudly instead of proceeding uncounted.
	content, isErr := p.handleWorkflowSpawn(params, `{"skill":"investigate","message":"x"}`, entry.SpawnableSkills)
	if !isErr || !strings.Contains(content, "unavailable") {
		t.Fatalf("missing capacity check must refuse, got isErr=%v content=%q", isErr, content)
	}
}

func TestWorkflowSpawnRespectsCapAndStartsSession(t *testing.T) {
	client := workflowRedisTestClient(t)
	p, grafanaURL := newWorkflowTestPlugin(t, stubLLMFinalAnswer("investigated"))
	p.redisClient = client
	p.ctx = context.Background()

	entry := validWorkflowEntry()
	entry.Name = "cap-wf"
	entry.SpawnableSkills = []string{"investigate"}
	entry.MaxConcurrentSessions = 1
	entry.SessionTimeoutSeconds = 60
	params := workflowRunParams{
		entry:       entry,
		grafanaURL:  grafanaURL,
		saToken:     "test-token",
		syntheticID: syntheticWorkflowUserID("cap-wf"),
	}

	if err := client.Del(p.ctx, workflowActiveSpawnKey("cap-wf")).Err(); err != nil {
		t.Fatalf("cleanup failed: %v", err)
	}

	content, isErr := p.handleWorkflowSpawn(params, `{"skill":"investigate","message":"check alert 1"}`, entry.SpawnableSkills)
	if isErr {
		t.Fatalf("first spawn must succeed: %q", content)
	}
	var ids struct {
		SessionID string `json:"sessionId"`
		RunID     string `json:"runId"`
	}
	if err := json.Unmarshal([]byte(content), &ids); err != nil || ids.SessionID == "" || ids.RunID == "" {
		t.Fatalf("spawn must return identifiers, got %q (%v)", content, err)
	}

	waitForCondition(t, 15*time.Second, "spawned session completion", func() bool {
		return runStatus(p, ids.RunID) == RunStatusCompleted
	})

	// The finished session left the active set, so the cap is free again.
	count, err := p.workflowActiveSpawnCount("cap-wf")
	if err != nil || count != 0 {
		t.Fatalf("active set must drain after completion: count=%d err=%v", count, err)
	}
}

func TestWorkflowShareToolCreatesLink(t *testing.T) {
	p, _ := newWorkflowTestPlugin(t, stubLLMFinalAnswer("ok"))

	entry := validWorkflowEntry()
	entry.OrgID = 1
	params := workflowRunParams{
		entry:       entry,
		syntheticID: syntheticWorkflowUserID("share-wf"),
	}

	// A session with one message plus a run holding streamed content and a
	// tool result: the share snapshot must carry the live investigation.
	session, err := p.sessionStore.CreateSession(params.syntheticID, entry.OrgID, "workflow share test", []SessionMessage{{
		Role:    "user",
		Content: "findings",
	}})
	if err != nil {
		t.Fatalf("session creation failed: %v", err)
	}
	runID := "share-run-1"
	p.runStore.CreateRun(runID, params.syntheticID, entry.OrgID, session.ID)
	p.runStore.AppendEvent(runID, agent.SSEEvent{Type: "content", Data: agent.ContentEvent{Content: "Root cause: "}})
	p.runStore.AppendEvent(runID, agent.SSEEvent{Type: "content", Data: agent.ContentEvent{Content: "disk saturation."}})
	p.runStore.AppendEvent(runID, agent.SSEEvent{
		Type: "tool_call_start",
		Data: agent.ToolCallStartEvent{ID: "tc-1", Name: "query_prometheus", Arguments: "{}"},
	})
	p.runStore.AppendEvent(runID, agent.SSEEvent{
		Type: "tool_call_result",
		Data: agent.ToolCallResultEvent{ID: "tc-1", Name: "query_prometheus", Content: "up 0", IsError: false},
	})

	content, isErr := p.handleWorkflowShare(params, session.ID, runID, `{}`)
	if isErr {
		t.Fatalf("share must succeed: %q", content)
	}
	if !strings.Contains(content, "/a/"+PluginID+"/shared/") {
		t.Fatalf("share must return the plugin share path, got %q", content)
	}
	if !strings.Contains(content, "orgId=1") {
		t.Fatalf("share must carry the org, got %q", content)
	}

	// The stored snapshot must include the live run transcript, not only the
	// persisted user prompt.
	parts := strings.Split(content, "/shared/")
	if len(parts) != 2 {
		t.Fatalf("share URL shape unexpected: %q", content)
	}
	shareID := strings.SplitN(parts[1], "?", 2)[0]
	share, getErr := p.shareStore.GetShare(shareID)
	if getErr != nil {
		t.Fatalf("share must be retrievable: %v", getErr)
	}
	body := string(share.SessionData)
	if !strings.Contains(body, "disk saturation.") {
		t.Fatalf("share snapshot must carry streamed assistant content: %s", body)
	}
	if !strings.Contains(body, "query_prometheus") {
		t.Fatalf("share snapshot must carry tool results: %s", body)
	}

	// Explicit lifetime is honored and bounded.
	if content, isErr := p.handleWorkflowShare(params, session.ID, runID, `{"expiresInDays":7}`); isErr || !strings.Contains(content, "7 days") {
		t.Fatalf("explicit lifetime must be honored, got isErr=%v content=%q", isErr, content)
	}
	if _, isErr := p.handleWorkflowShare(params, session.ID, runID, `{"expiresInDays":4000}`); !isErr {
		t.Fatal("out-of-range lifetime must be refused")
	}
}

// TestWorkflowShareTranscriptSurvivesRedisRunStore reproduces the production
// encoding path: the Redis run store JSON-unmarshals event Data into maps,
// not typed structs, so the share transcript must decode both.
func TestWorkflowShareTranscriptSurvivesRedisRunStore(t *testing.T) {
	client := workflowRedisTestClient(t)
	p, grafanaURL := newWorkflowTestPlugin(t, stubLLMFinalAnswer("ok"))
	p.redisClient = client
	p.runStore = NewRedisRunStore(p.ctx, client, log.DefaultLogger)

	entry := validWorkflowEntry()
	entry.OrgID = 1
	params := workflowRunParams{
		entry:       entry,
		grafanaURL:  grafanaURL,
		saToken:     "test-token",
		syntheticID: syntheticWorkflowUserID("share-redis-wf"),
	}
	session, err := p.sessionStore.CreateSession(params.syntheticID, entry.OrgID, "redis share test", []SessionMessage{{
		Role:    "user",
		Content: "findings",
	}})
	if err != nil {
		t.Fatalf("session creation failed: %v", err)
	}
	runID := "share-redis-run-1"
	p.runStore.CreateRun(runID, params.syntheticID, entry.OrgID, session.ID)
	p.runStore.AppendEvent(runID, agent.SSEEvent{Type: "content", Data: agent.ContentEvent{Content: "Root cause: disk saturation."}})
	p.runStore.AppendEvent(runID, agent.SSEEvent{
		Type: "tool_call_start",
		Data: agent.ToolCallStartEvent{ID: "tc-9", Name: "query_prometheus", Arguments: "{}"},
	})
	p.runStore.AppendEvent(runID, agent.SSEEvent{
		Type: "tool_call_result",
		Data: agent.ToolCallResultEvent{ID: "tc-9", Name: "query_prometheus", Content: "up 0", IsError: false},
	})

	content, isErr := p.handleWorkflowShare(params, session.ID, runID, `{}`)
	if isErr {
		t.Fatalf("share must succeed: %q", content)
	}
	parts := strings.Split(content, "/shared/")
	if len(parts) != 2 {
		t.Fatalf("share URL shape unexpected: %q", content)
	}
	share, getErr := p.shareStore.GetShare(strings.SplitN(parts[1], "?", 2)[0])
	if getErr != nil {
		t.Fatalf("share must be retrievable: %v", getErr)
	}
	body := string(share.SessionData)
	if !strings.Contains(body, "disk saturation.") {
		t.Fatalf("redis-encoded transcript must carry assistant content: %s", body)
	}
	if !strings.Contains(body, "query_prometheus") {
		t.Fatalf("redis-encoded transcript must carry tool calls: %s", body)
	}
}

// TestWorkflowSessionWithNilRunCancelsDoesNotPanic covers shutdown racing a
// session start: Dispose clears the run-cancel registry, and a session that
// starts after that must be cancelled cleanly instead of assigning into the
// nil map.
func TestWorkflowSessionWithNilRunCancelsDoesNotPanic(t *testing.T) {
	p, grafanaURL := newWorkflowTestPlugin(t, stubLLMHanging())

	entry := validWorkflowEntry()
	entry.Name = "nilcancels-wf"
	entry.Skill = "dispatch"
	entry.SessionTimeoutSeconds = 30
	p.runCancels = nil // simulates the Dispose window

	syntheticID := syntheticWorkflowUserID("nilcancels-wf")
	_, runID, err := p.startWorkflowSession(workflowRunParams{
		entry:       entry,
		skill:       "dispatch",
		message:     "Sweep.",
		grafanaURL:  grafanaURL,
		saToken:     "test-token",
		syntheticID: syntheticID,
	})
	if err != nil {
		t.Fatalf("session start failed: %v", err)
	}

	waitForCondition(t, 15*time.Second, "cancelled run", func() bool {
		return runStatus(p, runID) != RunStatusRunning && runStatus(p, runID) != ""
	})
}
