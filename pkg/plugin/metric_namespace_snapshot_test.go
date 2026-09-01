package plugin

import (
	"consensys-asko11y-app/pkg/mcp"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
)

func TestDeriveNamespaces(t *testing.T) {
	names := []string{
		"aws_applicationelb_request_count_sum",
		"aws_applicationelb_healthy_host_count_average",
		"kube_pod_status_phase",
		"up",
	}
	counts := deriveNamespaces(names)

	if counts["aws_applicationelb"] != 2 {
		t.Errorf("expected 2 aws_applicationelb metrics, got %d", counts["aws_applicationelb"])
	}
	if counts["kube_pod"] != 1 {
		t.Errorf("expected 1 kube_pod metric, got %d", counts["kube_pod"])
	}
	if counts["up"] != 1 {
		t.Errorf("expected single-segment metric name to be its own bucket, got %d", counts["up"])
	}
}

func TestRenderMetricNamespaceSnapshot_CapsAndSorts(t *testing.T) {
	rows := []datasourceRow{{dsType: "prometheus", name: "mimir", uid: "ds1"}}
	var names []string
	for i := 0; i < msMaxNamespacesPerDatasource+20; i++ {
		names = append(names, "zprefix"+itoa(i)+"_metric")
	}
	namesByUID := map[string][]string{"ds1": names}

	got := renderMetricNamespaceSnapshot(rows, namesByUID)

	lines := strings.Split(got, "\n")
	// One header line + capped namespace bullets.
	bulletLines := 0
	for _, l := range lines {
		if strings.HasPrefix(l, "- ") {
			bulletLines++
		}
	}
	if bulletLines > msMaxNamespacesPerDatasource {
		t.Fatalf("expected at most %d namespace bullets, got %d", msMaxNamespacesPerDatasource, bulletLines)
	}
	if !strings.Contains(got, "uid=ds1") {
		t.Fatalf("expected datasource uid in header, got:\n%s", got)
	}
}

func TestMetricNamespaceSnapshot_CacheHitSkipsFetch(t *testing.T) {
	p := &Plugin{
		logger:  log.DefaultLogger,
		msCache: map[string]dsCacheEntry{"1": {snapshot: "cached-snapshot", fetchedAt: time.Now(), ttl: msCacheTTL}},
	}

	got := p.metricNamespaceSnapshot("1", "Org1", "")
	if got != "cached-snapshot" {
		t.Fatalf("expected cached snapshot to be returned directly, got %q", got)
	}
}

// newMetricNamespaceSnapshotServer fakes an MCP server exposing both
// list_datasources (one Prometheus datasource) and
// list_prometheus_metric_names (a fixed metric list), counting calls to the
// metric-names tool so tests can assert the background refresh ran once.
func newMetricNamespaceSnapshotServer(t *testing.T, metricNamesCallCount *atomic.Int32) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/mcp/list-tools":
			_ = json.NewEncoder(w).Encode(struct {
				Tools []mcp.Tool `json:"tools"`
			}{Tools: []mcp.Tool{
				{Name: "list_datasources", InputSchema: map[string]interface{}{}},
				{Name: "list_prometheus_metric_names", InputSchema: map[string]interface{}{}},
			}})
		case "/mcp/call-tool":
			var req mcp.MCPRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				t.Errorf("failed to decode request: %v", err)
				return
			}
			var params mcp.CallToolParams
			if err := json.Unmarshal(req.Params, &params); err != nil {
				t.Errorf("failed to decode call params: %v", err)
				return
			}
			switch params.Name {
			case "list_datasources":
				_ = json.NewEncoder(w).Encode(mcp.CallToolResult{
					Content: []mcp.ContentBlock{{
						Type: "text",
						Text: `[{"uid":"ds1","name":"mimir","type":"prometheus"},{"uid":"ds2","name":"loki","type":"loki"}]`,
					}},
				})
			case "list_prometheus_metric_names":
				metricNamesCallCount.Add(1)
				_ = json.NewEncoder(w).Encode(mcp.CallToolResult{
					Content: []mcp.ContentBlock{{
						Type: "text",
						Text: `["aws_applicationelb_request_count_sum","aws_applicationelb_healthy_host_count_average","kube_pod_status_phase"]`,
					}},
				})
			default:
				t.Errorf("unexpected tool call: %s", params.Name)
			}
		default:
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
	}))
}

func TestMetricNamespaceSnapshot_MissReturnsEmptyThenBackgroundFillsCache(t *testing.T) {
	var metricNamesCalls atomic.Int32
	server := newMetricNamespaceSnapshotServer(t, &metricNamesCalls)
	defer server.Close()

	proxy := mcp.NewProxy(context.Background(), log.DefaultLogger)
	if err := proxy.EnsureServer(mcp.ServerConfig{
		ID: "mcp-grafana", Name: "Grafana", URL: server.URL, Type: "standard", Enabled: true,
	}); err != nil {
		t.Fatalf("failed to configure proxy: %v", err)
	}
	defer proxy.Close()

	p := &Plugin{
		logger:   log.DefaultLogger,
		mcpProxy: proxy,
	}

	// First call: cache miss. Must return "" immediately (never block on the
	// slow underlying fetch) and only queue a background refresh.
	got := p.metricNamespaceSnapshot("1", "Org1", "")
	if got != "" {
		t.Fatalf("expected empty snapshot on cache miss, got %q", got)
	}

	// The background refresh should populate the cache shortly after.
	deadline := time.Now().Add(2 * time.Second)
	var snapshot string
	for time.Now().Before(deadline) {
		if s, ok := p.lookupMetricNamespaceCache("1"); ok {
			snapshot = s
			break
		}
		time.Sleep(10 * time.Millisecond)
	}

	if !strings.Contains(snapshot, "aws_applicationelb") {
		t.Fatalf("expected background-refreshed snapshot to contain aws_applicationelb namespace, got %q", snapshot)
	}
	// Only the Prometheus-type datasource (ds1) should have been queried, not
	// the Loki one (ds2).
	if calls := metricNamesCalls.Load(); calls != 1 {
		t.Fatalf("expected exactly 1 list_prometheus_metric_names call (one Prometheus datasource), got %d", calls)
	}

	// A second call once cached must not trigger another fetch.
	got2 := p.metricNamespaceSnapshot("1", "Org1", "")
	if got2 != snapshot {
		t.Fatalf("expected second call to return the cached snapshot, got %q", got2)
	}
	if calls := metricNamesCalls.Load(); calls != 1 {
		t.Fatalf("expected cache hit not to trigger another fetch, got %d total calls", calls)
	}
}

func TestMetricNamespaceSnapshot_DedupesConcurrentRefreshes(t *testing.T) {
	var metricNamesCalls atomic.Int32
	server := newMetricNamespaceSnapshotServer(t, &metricNamesCalls)
	defer server.Close()

	proxy := mcp.NewProxy(context.Background(), log.DefaultLogger)
	if err := proxy.EnsureServer(mcp.ServerConfig{
		ID: "mcp-grafana", Name: "Grafana", URL: server.URL, Type: "standard", Enabled: true,
	}); err != nil {
		t.Fatalf("failed to configure proxy: %v", err)
	}
	defer proxy.Close()

	p := &Plugin{logger: log.DefaultLogger, mcpProxy: proxy}

	var wg sync.WaitGroup
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			p.metricNamespaceSnapshot("1", "Org1", "")
		}()
	}
	wg.Wait()

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if _, ok := p.lookupMetricNamespaceCache("1"); ok {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}

	if calls := metricNamesCalls.Load(); calls != 1 {
		t.Fatalf("expected concurrent misses to dedupe into a single background refresh, got %d calls", calls)
	}
}
