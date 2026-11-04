package mcp

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	"github.com/modelcontextprotocol/go-sdk/jsonrpc"
)

// refreshTestClient builds a Client with only the fields the catalog path
// reads, following retry_test.go. listFn stands in for the transport: the
// field is a seam, so no MCP server is needed.
func refreshTestClient(t *testing.T, listFn func(context.Context) ([]Tool, error)) *Client {
	t.Helper()

	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)

	c := &Client{
		config:    ServerConfig{ID: "test", Type: "streamable-http"},
		logger:    log.DefaultLogger,
		ctx:       ctx,
		listTools: listFn,
	}
	c.tools = []Tool{{Name: "test_old"}}
	c.catalogGen = 1
	return c
}

// staticLister returns a fixed catalog and counts how many times it ran.
func staticLister(tools []Tool, calls *int32) func(context.Context) ([]Tool, error) {
	return func(context.Context) ([]Tool, error) {
		atomic.AddInt32(calls, 1)
		return tools, nil
	}
}

func unknownToolErr(name string) error {
	return fmt.Errorf("failed to call tool: %w",
		fmt.Errorf("calling %q: %w", "tools/call",
			&jsonrpc.Error{
				Code:    jsonrpc.CodeInvalidParams,
				Message: fmt.Sprintf("unknown tool %q", name),
			}))
}

func TestIsUnknownToolError(t *testing.T) {
	tests := []struct {
		name string
		err  error
		want bool
	}{
		{name: "nil", err: nil, want: false},
		{name: "unauthorized", err: errors.New("unauthorized"), want: false},
		{name: "invalid args", err: errors.New("invalid params: missing field id"), want: false},
		{name: "wrapped sdk text", err: errors.New(`failed to call tool: calling "tools/call": unknown tool "x"`), want: true},
		{
			name: "jsonrpc invalid params",
			err:  fmt.Errorf("calling %q: %w", "tools/call", &jsonrpc.Error{Code: jsonrpc.CodeInvalidParams, Message: `unknown tool "x"`}),
			want: true,
		},
		{
			name: "jsonrpc invalid params without the phrase",
			err:  fmt.Errorf("calling %q: %w", "tools/call", &jsonrpc.Error{Code: jsonrpc.CodeInvalidParams, Message: "invalid params"}),
			want: false,
		},
		{
			name: "jsonrpc other code with the phrase",
			err:  fmt.Errorf("calling %q: %w", "tools/call", &jsonrpc.Error{Code: jsonrpc.CodeInternalError, Message: `unknown tool "x"`}),
			want: true,
		},
		{name: "uppercase phrase", err: errors.New(`Unknown Tool "x"`), want: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := isUnknownToolError(tt.err); got != tt.want {
				t.Fatalf("isUnknownToolError(%v) = %v, want %v", tt.err, got, tt.want)
			}
		})
	}
}

func TestListAndPublishIncrementsGeneration(t *testing.T) {
	var calls int32
	c := refreshTestClient(t, staticLister([]Tool{{Name: "alpha"}, {Name: "beta"}}, &calls))
	// Start cold so the first call publishes.
	c.tools = nil
	c.catalogGen = 0

	first, err := c.ListToolsWithContext(context.Background())
	if err != nil {
		t.Fatalf("first list: %v", err)
	}
	if got, want := len(first), 2; got != want {
		t.Fatalf("len(tools) = %d, want %d", got, want)
	}
	if first[0].Name != "test_alpha" || first[1].Name != "test_beta" {
		t.Fatalf("names = %q, want test_ prefix", []string{first[0].Name, first[1].Name})
	}
	if got, want := c.catalogGeneration(), uint64(1); got != want {
		t.Fatalf("catalogGen = %d, want %d", got, want)
	}

	// Second call is a cache hit: no listing, no new generation.
	if _, err := c.ListToolsWithContext(context.Background()); err != nil {
		t.Fatalf("second list: %v", err)
	}
	if got := atomic.LoadInt32(&calls); got != 1 {
		t.Fatalf("listings = %d, want 1", got)
	}
	if got, want := c.catalogGeneration(), uint64(1); got != want {
		t.Fatalf("catalogGen after cache hit = %d, want %d", got, want)
	}
}

// A stagger between replicas can drop a name from tools/list and accept it on
// tools/call. The retry covers that, and it must happen exactly once.
func TestCallToolRetriesOnceAfterRefresh(t *testing.T) {
	var calls, listings int32
	c := refreshTestClient(t, staticLister([]Tool{{Name: "renamed"}}, &listings))

	once := func(_ context.Context, name string, _ map[string]interface{}, _, _, _ string) (*CallToolResult, error) {
		n := atomic.AddInt32(&calls, 1)
		if n == 1 {
			return nil, unknownToolErr(name)
		}
		return &CallToolResult{Content: []ContentBlock{{Type: "text", Text: "ok"}}}, nil
	}

	result, err := c.callToolWithCatalogRefresh(context.Background(), once, "old", nil, "", "", "")
	if err != nil {
		t.Fatalf("call: %v", err)
	}
	if result == nil || len(result.Content) == 0 {
		t.Fatalf("result = %+v, want content", result)
	}
	if got := atomic.LoadInt32(&calls); got != 2 {
		t.Fatalf("call attempts = %d, want 2", got)
	}
	if got := atomic.LoadInt32(&listings); got != 1 {
		t.Fatalf("listings = %d, want 1", got)
	}
}

func TestCallToolDoesNotLoopOnPersistentUnknownTool(t *testing.T) {
	var calls, listings int32
	c := refreshTestClient(t, staticLister([]Tool{{Name: "alerting_rules_read"}}, &listings))

	once := func(_ context.Context, name string, _ map[string]interface{}, _, _, _ string) (*CallToolResult, error) {
		atomic.AddInt32(&calls, 1)
		return nil, unknownToolErr(name)
	}

	_, err := c.callToolWithCatalogRefresh(context.Background(), once, "alerting_manage_rules", nil, "", "", "")
	if err == nil {
		t.Fatal("want an error")
	}
	if got := atomic.LoadInt32(&calls); got != 2 {
		t.Fatalf("call attempts = %d, want 2", got)
	}
	if got := atomic.LoadInt32(&listings); got != 1 {
		t.Fatalf("listings = %d, want 1", got)
	}
	if !strings.Contains(err.Error(), "this server now provides") {
		t.Fatalf("error = %q, want a replacement hint", err)
	}
	if !strings.Contains(err.Error(), "alerting_rules_read") {
		t.Fatalf("error = %q, want the replacement name", err)
	}
}

func TestCallToolIgnoresNonUnknownErrors(t *testing.T) {
	var calls, listings int32
	c := refreshTestClient(t, staticLister([]Tool{{Name: "other"}}, &listings))

	wantErr := errors.New("unauthorized")
	once := func(_ context.Context, _ string, _ map[string]interface{}, _, _, _ string) (*CallToolResult, error) {
		atomic.AddInt32(&calls, 1)
		return nil, wantErr
	}

	_, err := c.callToolWithCatalogRefresh(context.Background(), once, "old", nil, "", "", "")
	if !errors.Is(err, wantErr) {
		t.Fatalf("err = %v, want the original error", err)
	}
	if got := atomic.LoadInt32(&calls); got != 1 {
		t.Fatalf("call attempts = %d, want 1", got)
	}
	if got := atomic.LoadInt32(&listings); got != 0 {
		t.Fatalf("listings = %d, want 0", got)
	}
	if strings.Contains(err.Error(), "this server now provides") {
		t.Fatalf("err = %q, want no hint on a non-unknown error", err)
	}
}

func TestCallToolOpenAPINeverRefreshes(t *testing.T) {
	var calls, listings int32
	c := refreshTestClient(t, staticLister([]Tool{{Name: "other"}}, &listings))
	c.config.Type = "openapi"

	once := func(_ context.Context, name string, _ map[string]interface{}, _, _, _ string) (*CallToolResult, error) {
		atomic.AddInt32(&calls, 1)
		return nil, unknownToolErr(name)
	}

	_, err := c.callToolWithCatalogRefresh(context.Background(), once, "old", nil, "", "", "")
	if err == nil {
		t.Fatal("want an error")
	}
	if got := atomic.LoadInt32(&calls); got != 1 {
		t.Fatalf("call attempts = %d, want 1", got)
	}
	if got := atomic.LoadInt32(&listings); got != 0 {
		t.Fatalf("listings = %d, want 0", got)
	}
	if strings.Contains(err.Error(), "this server now provides") {
		t.Fatalf("err = %q, want no hint for an OpenAPI server", err)
	}
}

func TestToolResultErrorDoesNotRefresh(t *testing.T) {
	var calls, listings int32
	c := refreshTestClient(t, staticLister([]Tool{{Name: "other"}}, &listings))

	once := func(_ context.Context, _ string, _ map[string]interface{}, _, _, _ string) (*CallToolResult, error) {
		atomic.AddInt32(&calls, 1)
		return &CallToolResult{
			Content: []ContentBlock{{Type: "text", Text: `unknown tool "x"`}},
			IsError: true,
		}, nil
	}

	result, err := c.callToolWithCatalogRefresh(context.Background(), once, "old", nil, "", "", "")
	if err != nil {
		t.Fatalf("call: %v", err)
	}
	if !result.IsError {
		t.Fatal("want IsError to be preserved")
	}
	if got := atomic.LoadInt32(&calls); got != 1 {
		t.Fatalf("call attempts = %d, want 1", got)
	}
	if got := atomic.LoadInt32(&listings); got != 0 {
		t.Fatalf("listings = %d, want 0: a tool result error must not trigger a refresh", got)
	}
}

func TestCacheKeyIncludesToolName(t *testing.T) {
	if cacheKey("test_old", "", "", 0, nil) == cacheKey("test_new", "", "", 0, nil) {
		t.Fatal("cache keys collide across tool names; a refreshed name could read a removed name's result")
	}
}

func TestEnrichUnknownToolError(t *testing.T) {
	c := &Client{config: ServerConfig{ID: "mcp-grafana"}, logger: log.DefaultLogger, tools: []Tool{
		{Name: "mcp-grafana_alerting_alertmanager_read"},
		{Name: "mcp-grafana_alerting_rules_read"},
		{Name: "mcp-grafana_get_tempo_trace"},
		{Name: "mcp-grafana_search_tempo_traces"},
		{Name: "mcp-grafana_query_tempo_metrics"},
		{Name: "mcp-grafana_list_teams"},
		{Name: "mcp-grafana_list_users"},
		{Name: "mcp-grafana_list_dashboards"},
		{Name: "mcp-grafana_get_dashboard"},
		{Name: "mcp-grafana_create_incident"},
	}}

	original := unknownToolErr("alerting_manage_rules")
	err := c.enrichUnknownToolError(original, "alerting_manage_rules")
	msg := err.Error()

	if !strings.HasPrefix(msg, original.Error()) {
		t.Fatalf("message must keep the original text as a prefix: %q", msg)
	}
	if !strings.Contains(msg, "alerting_rules_read") {
		t.Fatalf("message = %q, want the ranked replacement", msg)
	}
	if !strings.Contains(msg, "(2 more)") {
		t.Fatalf("message = %q, want the (2 more) tail for 10 tools and 8 shown", msg)
	}
	if strings.Contains(msg, "mcp-grafana_") {
		t.Fatalf("message = %q, want the server prefix stripped from the hint", msg)
	}
	if !errors.Is(err, original) && !errors.As(err, new(*jsonrpc.Error)) {
		t.Fatalf("errors.As must still find the wire error in %v", err)
	}

	// The ranking must put the two-token match first.
	ranked := rankToolNames("alerting_manage_rules", []string{
		"alerting_alertmanager_read", "alerting_rules_read", "list_teams",
	}, unknownToolHintLimit)
	if ranked[0] != "alerting_rules_read" {
		t.Fatalf("ranked[0] = %q, want alerting_rules_read", ranked[0])
	}
}

// A refused refresh leaves the catalog unchanged, so a hint would have to
// repeat the name that just failed. The caller must see the original envelope.
func TestCallToolRateLimitedProducesNoHint(t *testing.T) {
	var calls, listings int32
	c := refreshTestClient(t, staticLister([]Tool{{Name: "alerting_rules_read"}}, &listings))
	// A successful re-list moments ago: the 30s window refuses this refresh.
	c.lastRefresh = time.Now()

	original := unknownToolErr("alerting_manage_rules")
	once := func(_ context.Context, _ string, _ map[string]interface{}, _, _, _ string) (*CallToolResult, error) {
		atomic.AddInt32(&calls, 1)
		return nil, original
	}

	_, err := c.callToolWithCatalogRefresh(context.Background(), once, "alerting_manage_rules", nil, "", "", "")
	if err == nil {
		t.Fatal("want an error")
	}
	if !errors.Is(err, original) {
		t.Fatalf("err = %v, want the original error, not a hint", err)
	}
	if got := atomic.LoadInt32(&calls); got != 1 {
		t.Fatalf("call attempts = %d, want 1 (no retry without a refresh)", got)
	}
	if got := atomic.LoadInt32(&listings); got != 0 {
		t.Fatalf("listings = %d, want 0 inside the rate-limit window", got)
	}
	if strings.Contains(err.Error(), "this server now provides") {
		t.Fatalf("err = %q, want no hint when the refresh was refused", err)
	}
}

func TestEnrichUnknownToolErrorExcludesFailedName(t *testing.T) {
	const marker = "; this server now provides: "

	tests := []struct {
		name      string
		tools     []Tool
		failed    string
		wantHint  bool
		wantNames []string
	}{
		{
			name:      "catalog still holds the failed name",
			tools:     []Tool{{Name: "test_old"}, {Name: "test_new"}},
			failed:    "old",
			wantHint:  true,
			wantNames: []string{"new"},
		},
		{
			name:      "failed name passed with the server prefix",
			tools:     []Tool{{Name: "test_old"}, {Name: "test_new"}},
			failed:    "test_old",
			wantHint:  true,
			wantNames: []string{"new"},
		},
		{
			name:     "only the failed name remains",
			tools:    []Tool{{Name: "test_old"}},
			failed:   "old",
			wantHint: false,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			c := &Client{config: ServerConfig{ID: "test"}, logger: log.DefaultLogger, tools: tc.tools}
			base := unknownToolErr("old")
			err := c.enrichUnknownToolError(base, tc.failed)

			idx := strings.Index(err.Error(), marker)
			if !tc.wantHint {
				if idx >= 0 {
					t.Fatalf("err = %q, want no hint", err)
				}
				if err.Error() != base.Error() {
					t.Fatalf("err = %q, want the unchanged envelope %q", err, base)
				}
				return
			}
			if idx < 0 {
				t.Fatalf("err = %q, want a hint", err)
			}
			hint := err.Error()[idx+len(marker):]
			if strings.Contains(hint, "old") {
				t.Fatalf("hint = %q, must not list the failed tool", hint)
			}
			for _, want := range tc.wantNames {
				if !strings.Contains(hint, want) {
					t.Fatalf("hint = %q, want %q", hint, want)
				}
			}
		})
	}
}

func TestRefreshFailureKeepsCatalogAndHealth(t *testing.T) {
	var listings int32
	c := refreshTestClient(t, func(context.Context) ([]Tool, error) {
		atomic.AddInt32(&listings, 1)
		return nil, errors.New("connection refused")
	})

	refreshed, err := c.refreshTools(context.Background(), c.catalogGeneration())
	if refreshed {
		t.Fatal("refreshTools reported success on a failed listing")
	}
	if err == nil {
		t.Fatal("refreshTools swallowed the listing error")
	}

	c.mu.RLock()
	tools := c.tools
	stale := c.toolsStale
	c.mu.RUnlock()
	if len(tools) == 0 || tools[0].Name != "test_old" {
		t.Fatalf("tools = %+v, want the previous catalog", tools)
	}
	if stale {
		t.Fatal("toolsStale must be cleared after a failed refresh; otherwise every call re-lists")
	}

	// The health monitor calls ListTools: it must see the cached catalog and
	// no error, so a failed refresh cannot change the reported status.
	cached, err := c.ListToolsWithContext(context.Background())
	if err != nil {
		t.Fatalf("ListToolsWithContext after a failed refresh: %v", err)
	}
	if len(cached) == 0 {
		t.Fatal("ListToolsWithContext returned an empty catalog")
	}
	if got := atomic.LoadInt32(&listings); got != 1 {
		t.Fatalf("listings = %d, want 1 (the cache must serve the rest)", got)
	}
}

func TestRefreshRejectsEmptyCatalog(t *testing.T) {
	var listings int32
	c := refreshTestClient(t, staticLister(nil, &listings))

	refreshed, err := c.refreshTools(context.Background(), c.catalogGeneration())
	if refreshed {
		t.Fatal("an empty catalog must not count as a successful refresh")
	}
	if err == nil {
		t.Fatal("want an error for an empty catalog")
	}

	tools, listErr := c.ListToolsWithContext(context.Background())
	if listErr != nil {
		t.Fatalf("ListToolsWithContext: %v", listErr)
	}
	if len(tools) != 1 || tools[0].Name != "test_old" {
		t.Fatalf("tools = %+v, want the previous catalog kept", tools)
	}
}

func TestRefreshRateLimit(t *testing.T) {
	var listings int32
	c := refreshTestClient(t, staticLister([]Tool{{Name: "new"}}, &listings))
	gen := c.catalogGeneration()

	c.refreshMu.Lock()
	c.lastRefresh = time.Now()
	c.refreshMu.Unlock()

	refreshed, err := c.refreshTools(context.Background(), gen)
	if refreshed || err != nil {
		t.Fatalf("refreshTools = (%v, %v), want (false, nil) inside the window", refreshed, err)
	}
	if got := atomic.LoadInt32(&listings); got != 0 {
		t.Fatalf("listings = %d, want 0 inside the 30s window", got)
	}

	c.refreshMu.Lock()
	c.lastRefresh = time.Now().Add(-toolCatalogRefreshMinInterval - time.Second)
	c.refreshMu.Unlock()

	refreshed, err = c.refreshTools(context.Background(), gen)
	if !refreshed || err != nil {
		t.Fatalf("refreshTools = (%v, %v), want (true, nil) after the window", refreshed, err)
	}
	if got := atomic.LoadInt32(&listings); got != 1 {
		t.Fatalf("listings = %d, want 1 after the window", got)
	}
}

func TestRefreshToolsSingleFlight(t *testing.T) {
	var listings int32
	c := refreshTestClient(t, func(context.Context) ([]Tool, error) {
		atomic.AddInt32(&listings, 1)
		time.Sleep(50 * time.Millisecond)
		return []Tool{{Name: "new"}}, nil
	})
	gen := c.catalogGeneration()

	const callers = 8
	var wg sync.WaitGroup
	results := make([]bool, callers)
	wg.Add(callers)
	for i := 0; i < callers; i++ {
		go func(i int) {
			defer wg.Done()
			refreshed, _ := c.refreshTools(context.Background(), gen)
			results[i] = refreshed
		}(i)
	}
	wg.Wait()

	if got := atomic.LoadInt32(&listings); got != 1 {
		t.Fatalf("listings = %d, want exactly 1 for %d concurrent callers", got, callers)
	}
	for i, refreshed := range results {
		if !refreshed {
			t.Fatalf("caller %d did not retry", i)
		}
	}
}

func TestRefreshWaiterRetriesWithoutSecondList(t *testing.T) {
	var listings int32
	c := refreshTestClient(t, staticLister([]Tool{{Name: "new"}}, &listings))
	staleGen := c.catalogGeneration()

	if refreshed, err := c.refreshTools(context.Background(), staleGen); !refreshed || err != nil {
		t.Fatalf("first refresh = (%v, %v)", refreshed, err)
	}

	// A caller that captured the generation before the first refresh must
	// retry without listing again.
	refreshed, err := c.refreshTools(context.Background(), staleGen)
	if !refreshed || err != nil {
		t.Fatalf("waiter refresh = (%v, %v), want (true, nil)", refreshed, err)
	}
	if got := atomic.LoadInt32(&listings); got != 1 {
		t.Fatalf("listings = %d, want 1: the waiter must reuse the finished refresh", got)
	}
}

func TestListToolsConcurrentWithInvalidate(t *testing.T) {
	var listings int32
	c := refreshTestClient(t, func(context.Context) ([]Tool, error) {
		atomic.AddInt32(&listings, 1)
		return []Tool{{Name: "new"}}, nil
	})

	var wg sync.WaitGroup
	for i := 0; i < 16; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			c.ListToolsWithContext(context.Background())
			c.markToolsStale()
			c.ListToolsWithContext(context.Background())
			c.catalogGeneration()
		}()
	}
	wg.Wait()

	c.mu.RLock()
	defer c.mu.RUnlock()
	if c.tools == nil {
		t.Fatal("tools must never be nil after a publication")
	}
}

func TestToolDirtyFlagTriggersRelist(t *testing.T) {
	var listings int32
	c := refreshTestClient(t, staticLister([]Tool{{Name: "new"}}, &listings))

	c.onToolListChanged(context.Background(), nil)

	tools, err := c.ListToolsWithContext(context.Background())
	if err != nil {
		t.Fatalf("list after notification: %v", err)
	}
	if len(tools) != 1 || tools[0].Name != "test_new" {
		t.Fatalf("tools = %+v, want the re-listed catalog", tools)
	}
	if got := atomic.LoadInt32(&listings); got != 1 {
		t.Fatalf("listings = %d, want 1 (the notification must force one re-list)", got)
	}
	if c.toolsDirty.Load() {
		t.Fatal("toolsDirty must be cleared by the publication")
	}
}

func TestToolListChangedHandlerTakesNoLock(t *testing.T) {
	c := refreshTestClient(t, staticLister(nil, new(int32)))

	// The SDK dispatches the notification from the connection reader while
	// connectMCP holds mu. If the handler took mu, this would deadlock.
	c.mu.Lock()
	done := make(chan struct{})
	go func() {
		defer close(done)
		c.onToolListChanged(context.Background(), nil)
	}()

	select {
	case <-done:
	case <-time.After(time.Second):
		c.mu.Unlock()
		t.Fatal("onToolListChanged blocked while mu was held")
	}
	c.mu.Unlock()

	if !c.toolsDirty.Load() {
		t.Fatal("onToolListChanged must set the dirty flag")
	}
}

func BenchmarkListToolsWithContextCacheHit(b *testing.B) {
	ctx := context.Background()
	c := &Client{
		config: ServerConfig{ID: "test", Type: "streamable-http"},
		logger: log.DefaultLogger,
		ctx:    ctx,
		tools:  []Tool{{Name: "test_old"}},
		listTools: func(context.Context) ([]Tool, error) {
			b.Fatal("the cache-hit path must not list")
			return nil, nil
		},
	}

	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if _, err := c.ListToolsWithContext(ctx); err != nil {
			b.Fatal(err)
		}
	}
}
