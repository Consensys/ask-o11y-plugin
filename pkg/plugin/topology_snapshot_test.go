package plugin

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	mcpsdk "github.com/modelcontextprotocol/go-sdk/mcp"

	"consensys-asko11y-app/pkg/mcp"
)

// --- unit tests: parsing, merging, scoping, rendering ---

func TestParseServiceGraphSamples(t *testing.T) {
	valid := `{"data":[
		{"metric":{"client":"checkout","server":"payment"},"value":[1758800000,"12.34"]},
		{"metric":{"client":"frontend","server":"checkout"},"value":[1758800000,"0.005"]},
		{"metric":{"client_service":"cart","server_service":"db"},"value":[1758800000,"3"]},
		{"metric":{},"value":[1758800000,"9"]},
		{"metric":{"client":"x","server":"y"},"value":[1758800000,7]}
	]}`
	edges := parseServiceGraphSamples(valid)
	if len(edges) != 3 {
		t.Fatalf("expected 3 parsed edges (skipping unlabeled and non-string values), got %d: %+v", len(edges), edges)
	}
	if edges[0].client != "checkout" || edges[0].server != "payment" || edges[0].rps != 12.34 {
		t.Errorf("edge[0] = %+v, want checkout->payment at 12.34 rps", edges[0])
	}
	if edges[2].client != "cart" || edges[2].server != "db" {
		t.Errorf("edge[2] = %+v, want client_service/server_service fallback", edges[2])
	}

	if got := parseServiceGraphSamples(`{"status":"error","data":{"result":[]}}`); got != nil {
		t.Errorf("scalar/object data must yield nil, got %+v", got)
	}
	if got := parseServiceGraphSamples(`not json at all`); got != nil {
		t.Errorf("non-JSON body must yield nil, got %+v", got)
	}
}

func TestMergeServiceGraphFailures(t *testing.T) {
	edges := []serviceGraphEdge{
		{client: "checkout", server: "payment", rps: 10},
		{client: "a", server: "b", rps: 5},
	}
	failures := []serviceGraphEdge{{client: "checkout", server: "payment", rps: 2.5}}

	mergeServiceGraphFailures(edges, failures)

	if !edges[0].failed || edges[0].errRate < 0.249 || edges[0].errRate > 0.251 {
		t.Errorf("checkout->payment = %+v, want errRate 0.25", edges[0])
	}
	if edges[1].failed || edges[1].errRate != 0 {
		t.Errorf("a->b = %+v, want untouched", edges[1])
	}
}

func TestScopeServiceGraph(t *testing.T) {
	edges := []serviceGraphEdge{
		{client: "other", server: "other2", rps: 100},
		{client: "db", server: "checkout", rps: 5},
		{client: "checkout", server: "payment", rps: 10},
	}

	scoped := scopeServiceGraph(edges, "checkout")
	if len(scoped) != 2 {
		t.Fatalf("expected only the 1-hop neighborhood, got %+v", scoped)
	}
	if got := scopeServiceGraph(edges, "nosuchservice"); len(got) != 3 {
		t.Errorf("a service name matching nothing must fall back to the full list, got %+v", got)
	}
	if got := scopeServiceGraph(edges, ""); len(got) != 3 {
		t.Errorf("no service label must keep the full list, got %+v", got)
	}
}

func TestRenderServiceTopology(t *testing.T) {
	edges := make([]serviceGraphEdge, 0, topoMaxEdges+5)
	for i := 0; i < topoMaxEdges+5; i++ {
		edges = append(edges, serviceGraphEdge{client: fmt.Sprintf("svc%03d", i), server: "db", rps: float64(i + 1)})
	}
	edges[0].rps = 0.005 // below the noise floor

	got := renderServiceTopology(edges)
	if got == "" {
		t.Fatal("expected non-empty rendering")
	}
	edgeLines := 0
	for _, l := range strings.Split(got, "\n") {
		if strings.Contains(l, " -> ") {
			edgeLines++
		}
	}
	if edgeLines != topoMaxEdges {
		t.Errorf("expected %d rendered edges, got %d", topoMaxEdges, edgeLines)
	}
	if strings.Contains(got, "svc000") {
		t.Errorf("sub-floor edge must be dropped, got:\n%s", got)
	}
	// Most traffic first: the highest-rps edge (svc044) must appear before
	// lower ones.
	if strings.Index(got, "svc044 -> db") > strings.Index(got, "svc040 -> db") {
		t.Errorf("edges must sort by descending rps:\n%s", got)
	}

	if got := renderServiceTopology(nil); got != "" {
		t.Errorf("empty edge set must render nothing, got %q", got)
	}
}

func TestRenderGraphitiTopology(t *testing.T) {
	got := renderGraphitiTopology([]TopologyEdge{
		{ID: "checkout->cart", Source: "checkout", Target: "cart"},
		{ID: "frontend->flagd", Source: "frontend", Target: "flagd"},
	})
	if !strings.Contains(got, "checkout -> cart") || !strings.Contains(got, "frontend -> flagd") {
		t.Errorf("rendering missing edges:\n%s", got)
	}
	if got := renderGraphitiTopology(nil); got != "" {
		t.Errorf("empty edges must render nothing, got %q", got)
	}
}

func TestExtractServiceLabelFromSnapshot(t *testing.T) {
	snapshot := "### Rule: HighErrors\n- Labels: alertname=\"HighErrors\", service=\"checkout\"\n"
	if got := extractServiceLabelFromSnapshot(snapshot); got != "checkout" {
		t.Errorf("label = %q, want checkout", got)
	}
	if got := extractServiceLabelFromSnapshot("- Labels: alertname=\"X\"\n"); got != "" {
		t.Errorf("expected no service label, got %q", got)
	}
	if got := extractServiceLabelFromSnapshot(""); got != "" {
		t.Errorf("empty snapshot must yield empty label, got %q", got)
	}
}

// --- integration: fake MCP servers through the real proxy ---

// newTopologySnapshotServer fakes a "standard" MCP server exposing
// list_datasources and query_prometheus. The query handler returns an
// instant-vector body for the service-graph total query and a failed-request
// vector for the failed query, counting query calls.
func newTopologySnapshotServer(t *testing.T, queryCalls *atomic.Int32, totalBody, failedBody string, checkArgs func(t *testing.T, params mcp.CallToolParams)) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/mcp/list-tools":
			_ = json.NewEncoder(w).Encode(struct {
				Tools []mcp.Tool `json:"tools"`
			}{Tools: []mcp.Tool{
				{Name: "list_datasources", InputSchema: map[string]interface{}{}},
				{Name: "query_prometheus", InputSchema: map[string]interface{}{}},
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
			var body string
			switch params.Name {
			case "list_datasources":
				body = `[{"uid":"prom1","name":"Prom","type":"prometheus"}]`
			case "query_prometheus":
				queryCalls.Add(1)
				if checkArgs != nil {
					checkArgs(t, params)
				}
				args := params.Arguments
				expr, _ := args["expr"].(string)
				if strings.Contains(expr, "failed_total") {
					body = failedBody
				} else {
					body = totalBody
				}
			default:
				t.Errorf("unexpected tool call: %s", params.Name)
				body = `[]`
			}
			_ = json.NewEncoder(w).Encode(mcp.CallToolResult{
				Content: []mcp.ContentBlock{{Type: "text", Text: body}},
			})
		default:
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
	}))
}

func TestTopologySnapshot_ServiceGraphPrimaryAndCached(t *testing.T) {
	var queryCalls atomic.Int32
	totalBody := `{"data":[
		{"metric":{"client":"checkout","server":"payment"},"value":[1758800000,"12.34"]},
		{"metric":{"client":"frontend","server":"checkout"},"value":[1758800000,"0.005"]},
		{"metric":{"client":"checkout","server":"db"},"value":[1758800000,"30"]}
	]}`
	failedBody := `{"data":[{"metric":{"client":"checkout","server":"payment"},"value":[1758800000,"1.234"]}]}`
	var seenArgs mcp.CallToolParams

	server := newTopologySnapshotServer(t, &queryCalls, totalBody, failedBody, func(t *testing.T, params mcp.CallToolParams) {
		if seenArgs.Arguments == nil {
			seenArgs = params // first query (the total-rate one)
		}
	})
	defer server.Close()

	proxy := mcp.NewProxy(context.Background(), log.DefaultLogger)
	if err := proxy.EnsureServer(mcp.ServerConfig{
		ID: "mcp-grafana", Name: "Grafana", URL: server.URL, Type: "standard", Enabled: true,
	}); err != nil {
		t.Fatalf("failed to configure proxy: %v", err)
	}
	defer proxy.Close()
	p := &Plugin{logger: log.DefaultLogger, mcpProxy: proxy}

	snapshot := p.topologySnapshot(`- Labels: service="checkout"`, "1", "Org1", "")

	// Service scoping: the alert names checkout, so the busy-but-unrelated
	// frontend->checkout edge (sub-floor anyway) and no other services'
	// edges appear; checkout->db and checkout->payment do.
	if !strings.Contains(snapshot, "checkout -> payment (rps 12.34, err 10.0%)") {
		t.Errorf("expected checkout->payment edge with error rate, got:\n%s", snapshot)
	}
	if !strings.Contains(snapshot, "checkout -> db (rps 30.00)") {
		t.Errorf("expected checkout->db edge, got:\n%s", snapshot)
	}
	if strings.Contains(snapshot, "frontend") {
		t.Errorf("expected edges scoped to the alert's service, got:\n%s", snapshot)
	}

	// The query went out with both schema generations' required fields.
	args := seenArgs.Arguments
	if args["expr"] != topoTotalQuery || args["datasourceUid"] != "prom1" || args["endTime"] != "now" || args["queryType"] != "instant" {
		t.Errorf("query_prometheus args = %+v, want expr/datasourceUid/endTime/queryType", args)
	}

	// Second call: served from the per-org cache, no extra fetches.
	before := queryCalls.Load()
	snapshot2 := p.topologySnapshot(`- Labels: service="checkout"`, "1", "Org1", "")
	if snapshot2 != snapshot {
		t.Errorf("cached snapshot differs:\nfirst:\n%s\nsecond:\n%s", snapshot, snapshot2)
	}
	if queryCalls.Load() != before {
		t.Errorf("cache hit re-fetched queries: %d -> %d", before, queryCalls.Load())
	}
}

func TestTopologySnapshot_CacheMissStored(t *testing.T) {
	// A proxy with no servers at all: every lookup fails, the snapshot is
	// empty — and the miss is cached so repeated runs don't re-pay it.
	proxy := mcp.NewProxy(context.Background(), log.DefaultLogger)
	defer proxy.Close()
	p := &Plugin{logger: log.DefaultLogger, mcpProxy: proxy}

	if got := p.topologySnapshot("", "1", "Org1", ""); got != "" {
		t.Errorf("expected empty snapshot, got %q", got)
	}
	if _, ok := p.lookupTopologyCache("1\x00"); !ok {
		t.Error("expected the miss to be cached with the short miss TTL")
	}
}

// TestTopologySnapshot_CacheKeyIncludesService proves a second alert for a
// different service in the same org does not reuse the first alert's scoped
// neighborhood: the cache key includes the scoped service label.
func TestTopologySnapshot_CacheKeyIncludesService(t *testing.T) {
	var queryCalls atomic.Int32
	totalBody := `{"data":[
		{"metric":{"client":"checkout","server":"payment"},"value":[1758800000,"12.34"]},
		{"metric":{"client":"checkout","server":"db"},"value":[1758800000,"30"]}
	]}`
	failedBody := `{"data":[]}`

	server := newTopologySnapshotServer(t, &queryCalls, totalBody, failedBody, nil)
	defer server.Close()

	proxy := mcp.NewProxy(context.Background(), log.DefaultLogger)
	if err := proxy.EnsureServer(mcp.ServerConfig{
		ID: "mcp-grafana", Name: "Grafana", URL: server.URL, Type: "standard", Enabled: true,
	}); err != nil {
		t.Fatalf("failed to configure proxy: %v", err)
	}
	defer proxy.Close()
	p := &Plugin{logger: log.DefaultLogger, mcpProxy: proxy}

	checkout := p.topologySnapshot(`- Labels: service="checkout"`, "1", "Org1", "")
	if !strings.Contains(checkout, "checkout -> db") {
		t.Fatalf("expected checkout-scoped snapshot, got:\n%s", checkout)
	}

	// Same org, different service: a cache hit here would leak checkout's
	// neighborhood into payment's prompt.
	payment := p.topologySnapshot(`- Labels: service="payment"`, "1", "Org1", "")
	if got := queryCalls.Load(); got != 4 { // total+failed re-fetched for the new scope
		t.Errorf("scoped snapshot was served from the wrong cache entry: %d extra queries", got-2)
	}
	if strings.Contains(payment, "checkout -> db") {
		t.Errorf("payment-scoped snapshot leaked checkout's edges:\n%s", payment)
	}
	if !strings.Contains(payment, "checkout -> payment") {
		t.Errorf("expected payment as the 1-hop server edge, got:\n%s", payment)
	}
}

// TestTopologySnapshot_GraphitiFallback proves the fallback: with no
// query_prometheus tool available, the snapshot renders edges from Graphiti
// relationship facts instead.
func TestTopologySnapshot_GraphitiFallback(t *testing.T) {
	factBody := `{"message":"Facts retrieved successfully","facts":[
		{"name":"CALLS","fact":"checkout service calls cart service via gRPC"},
		{"name":"CALLS","fact":"frontend calls flagd service via gRPC"}
	]}`
	var factCalls atomic.Int32

	srv := mcpsdk.NewServer(&mcpsdk.Implementation{Name: "fake", Version: "1.0.0"}, nil)
	srv.AddTool(&mcpsdk.Tool{Name: "graphiti_search_memory_facts", InputSchema: map[string]any{"type": "object"}}, func(ctx context.Context, req *mcpsdk.CallToolRequest) (*mcpsdk.CallToolResult, error) {
		factCalls.Add(1)
		return &mcpsdk.CallToolResult{Content: []mcpsdk.Content{&mcpsdk.TextContent{Text: factBody}}}, nil
	})
	server := httptest.NewServer(mcpsdk.NewStreamableHTTPHandler(func(*http.Request) *mcpsdk.Server { return srv }, nil))
	defer server.Close()

	proxy := mcp.NewProxy(context.Background(), log.DefaultLogger)
	if err := proxy.UpdateConfig([]mcp.ServerConfig{{
		ID: "fake", Name: "fake", URL: server.URL, Type: "streamable-http", Enabled: true,
	}}); err != nil {
		t.Fatalf("failed to configure proxy: %v", err)
	}
	defer proxy.Close()
	p := &Plugin{logger: log.DefaultLogger, mcpProxy: proxy}

	snapshot := p.topologySnapshot("", "1", "Org1", "")
	if factCalls.Load() == 0 {
		t.Fatal("expected the graphiti facts tool to be called")
	}
	if !strings.Contains(snapshot, "checkout -> cart") || !strings.Contains(snapshot, "frontend -> flagd") {
		t.Errorf("expected graphiti edges rendered, got:\n%s", snapshot)
	}
}

// Tenants often have several Prometheus datasources and only one carries the
// service-graph series (mmcx: default "Prometheus" empty, central-metrics
// populated). The snapshot must probe past empty datasources.
func TestTopologySnapshot_ProbesMultiplePrometheusDatasources(t *testing.T) {
	var queried []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/mcp/list-tools":
			_ = json.NewEncoder(w).Encode(struct {
				Tools []mcp.Tool `json:"tools"`
			}{Tools: []mcp.Tool{
				{Name: "list_datasources", InputSchema: map[string]interface{}{}},
				{Name: "query_prometheus", InputSchema: map[string]interface{}{}},
			}})
		case "/mcp/call-tool":
			var req mcp.MCPRequest
			_ = json.NewDecoder(r.Body).Decode(&req)
			var params mcp.CallToolParams
			_ = json.Unmarshal(req.Params, &params)
			body := `{"data":[]}`
			switch params.Name {
			case "list_datasources":
				body = `[{"uid":"empty","name":"Prometheus","type":"prometheus"},{"uid":"loki1","name":"Loki","type":"loki"},{"uid":"central","name":"central-metrics","type":"prometheus"}]`
			case "query_prometheus":
				uid, _ := params.Arguments["datasourceUid"].(string)
				expr, _ := params.Arguments["expr"].(string)
				if !strings.Contains(expr, "failed_total") {
					queried = append(queried, uid)
				}
				if uid == "central" && !strings.Contains(expr, "failed_total") {
					body = `{"data":[{"metric":{"client":"api","server":"db"},"value":[1758800000,"5"]}]}`
				}
			}
			_ = json.NewEncoder(w).Encode(mcp.CallToolResult{
				Content: []mcp.ContentBlock{{Type: "text", Text: body}},
			})
		}
	}))
	defer server.Close()

	proxy := mcp.NewProxy(context.Background(), log.DefaultLogger)
	if err := proxy.EnsureServer(mcp.ServerConfig{
		ID: "mcp-grafana", Name: "Grafana", URL: server.URL, Type: "standard", Enabled: true,
	}); err != nil {
		t.Fatalf("failed to configure proxy: %v", err)
	}
	defer proxy.Close()
	p := &Plugin{logger: log.DefaultLogger, mcpProxy: proxy}

	snapshot := p.topologySnapshot("", "1", "Org1", "")
	if !strings.Contains(snapshot, "api -> db (rps 5.00)") {
		t.Errorf("expected edge from the second Prometheus datasource, got:\n%s", snapshot)
	}
	if strings.Join(queried, ",") != "empty,central" {
		t.Errorf("queried datasources = %v, want [empty central] (loki skipped)", queried)
	}
}
