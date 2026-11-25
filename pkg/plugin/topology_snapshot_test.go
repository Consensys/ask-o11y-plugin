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

// countRenderedEdges counts the rendered edge lines in a topology snapshot.
func countRenderedEdges(rendered string) int {
	edges := 0
	for _, l := range strings.Split(rendered, "\n") {
		if strings.Contains(l, " -> ") {
			edges++
		}
	}
	return edges
}

func TestRenderServiceTopology(t *testing.T) {
	limits := topoLimits{maxNodes: hardTopologyMaxNodes, maxEdges: 40, maxFacts: graphitiFallbackMaxFacts}
	edges := make([]serviceGraphEdge, 0, limits.maxEdges+5)
	for i := 0; i < limits.maxEdges+5; i++ {
		edges = append(edges, serviceGraphEdge{client: fmt.Sprintf("svc%03d", i), server: "db", rps: float64(i + 1)})
	}
	edges[0].rps = 0.005 // below the noise floor

	got := renderServiceTopology(edges, limits)
	if got == "" {
		t.Fatal("expected non-empty rendering")
	}
	if edgeLines := countRenderedEdges(got); edgeLines != limits.maxEdges {
		t.Errorf("expected %d rendered edges, got %d", limits.maxEdges, edgeLines)
	}
	if strings.Contains(got, "svc000") {
		t.Errorf("sub-floor edge must be dropped, got:\n%s", got)
	}
	// Most traffic first: the highest-rps edge (svc044) must appear before
	// lower ones.
	if strings.Index(got, "svc044 -> db") > strings.Index(got, "svc040 -> db") {
		t.Errorf("edges must sort by descending rps:\n%s", got)
	}

	if got := renderServiceTopology(nil, limits); got != "" {
		t.Errorf("empty edge set must render nothing, got %q", got)
	}
}

func TestRenderServiceTopologyConfiguredCaps(t *testing.T) {
	edges := []serviceGraphEdge{
		{client: "a", server: "b", rps: 30},
		{client: "c", server: "d", rps: 20},
		{client: "e", server: "f", rps: 10},
	}

	edgeLimited := topoLimits{maxNodes: defaultTopologyMaxNodes, maxEdges: 2, maxFacts: graphitiFallbackMaxFacts}
	if got := countRenderedEdges(renderServiceTopology(edges, edgeLimited)); got != 2 {
		t.Errorf("maxEdges=2 rendered %d edges, want 2", got)
	}

	nodeLimited := edgeLimited
	nodeLimited.maxEdges = 10
	nodeLimited.maxNodes = 2
	got := renderServiceTopology(edges, nodeLimited)
	if n := countRenderedEdges(got); n != 1 {
		t.Errorf("maxNodes=2 rendered %d edges, want 1:\n%s", n, got)
	}
	if strings.Contains(got, "c -> d") || strings.Contains(got, "e -> f") {
		t.Errorf("maxNodes=2 must keep only edges among 2 endpoints, got:\n%s", got)
	}
}

func TestRenderServiceTopologyNodeCapSkipsRatherThanStops(t *testing.T) {
	limits := topoLimits{maxNodes: 3, maxEdges: 10, maxFacts: graphitiFallbackMaxFacts}
	edges := []serviceGraphEdge{
		{client: "a", server: "b", rps: 30}, // keeps nodes a,b
		{client: "c", server: "d", rps: 20}, // skipped: would be 4 nodes
		{client: "a", server: "c", rps: 10}, // kept: only node c is new -> 3
	}
	got := renderServiceTopology(edges, limits)
	if !strings.Contains(got, "a -> b") || !strings.Contains(got, "a -> c") {
		t.Errorf("expected edges among 3 endpoints, skipping c->d, got:\n%s", got)
	}
	if strings.Contains(got, "c -> d") {
		t.Errorf("c -> d exceeds maxNodes=3 and must be skipped:\n%s", got)
	}
}

func TestRenderGraphitiTopology(t *testing.T) {
	limits := topoLimits{maxNodes: defaultTopologyMaxNodes, maxEdges: defaultTopologyMaxEdges, maxFacts: graphitiFallbackMaxFacts}
	got := renderGraphitiTopology([]TopologyEdge{
		{ID: "checkout->cart", Source: "checkout", Target: "cart"},
		{ID: "frontend->flagd", Source: "frontend", Target: "flagd"},
	}, limits)
	if !strings.Contains(got, "checkout -> cart") || !strings.Contains(got, "frontend -> flagd") {
		t.Errorf("rendering missing edges:\n%s", got)
	}
	if got := renderGraphitiTopology(nil, limits); got != "" {
		t.Errorf("empty edges must render nothing, got %q", got)
	}
}

func TestRenderGraphitiTopologyConfiguredCaps(t *testing.T) {
	edges := []TopologyEdge{
		{Source: "a", Target: "b"},
		{Source: "c", Target: "d"},
		{Source: "a", Target: "c"},
	}

	edgeLimited := topoLimits{maxNodes: defaultTopologyMaxNodes, maxEdges: 1, maxFacts: graphitiFallbackMaxFacts}
	if got := countRenderedEdges(renderGraphitiTopology(edges, edgeLimited)); got != 1 {
		t.Errorf("maxEdges=1 rendered %d edges, want 1", got)
	}

	nodeLimited := edgeLimited
	nodeLimited.maxEdges = 10
	nodeLimited.maxNodes = 3
	got := renderGraphitiTopology(edges, nodeLimited)
	if !strings.Contains(got, "a -> b") || !strings.Contains(got, "a -> c") {
		t.Errorf("expected edges among 3 endpoints, got:\n%s", got)
	}
	if strings.Contains(got, "c -> d") {
		t.Errorf("c -> d exceeds maxNodes=3 and must be skipped:\n%s", got)
	}
}

func TestPluginTopologyLimits(t *testing.T) {
	unset := (&Plugin{}).topologyLimits()
	if unset.maxNodes != defaultTopologyMaxNodes || unset.maxEdges != defaultTopologyMaxEdges {
		t.Errorf("unset limits = %+v, want %d/%d", unset, defaultTopologyMaxNodes, defaultTopologyMaxEdges)
	}
	if unset.maxFacts != defaultTopologyMaxEdges {
		t.Errorf("unset maxFacts = %d, want at least maxEdges (%d)", unset.maxFacts, defaultTopologyMaxEdges)
	}

	configured := (&Plugin{settings: PluginSettings{ServiceGraphMaxNodes: 2, ServiceGraphMaxEdges: 300}}).topologyLimits()
	if configured.maxNodes != 2 || configured.maxEdges != 300 {
		t.Errorf("configured limits = %+v, want 2/300", configured)
	}
	if configured.maxFacts != 300 {
		t.Errorf("maxFacts = %d, want at least maxEdges (300)", configured.maxFacts)
	}

	clamped := (&Plugin{settings: PluginSettings{
		ServiceGraphMaxNodes: hardTopologyMaxNodes + 1,
		ServiceGraphMaxEdges: hardTopologyMaxEdges + 1,
	}}).topologyLimits()
	if clamped.maxNodes != hardTopologyMaxNodes || clamped.maxEdges != hardTopologyMaxEdges {
		t.Errorf("clamped limits = %+v, want %d/%d", clamped, hardTopologyMaxNodes, hardTopologyMaxEdges)
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

	snapshot := p.topologySnapshot(context.Background(), `- Labels: service="checkout"`, "1", "Org1", "")

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
	snapshot2 := p.topologySnapshot(context.Background(), `- Labels: service="checkout"`, "1", "Org1", "")
	if snapshot2 != snapshot {
		t.Errorf("cached snapshot differs:\nfirst:\n%s\nsecond:\n%s", snapshot, snapshot2)
	}
	if queryCalls.Load() != before {
		t.Errorf("cache hit re-fetched queries: %d -> %d", before, queryCalls.Load())
	}
}

// TestTopologySnapshot_HonorsConfiguredServiceGraphLimits proves the admin
// Service Graph limits reach the RCA snapshot: maxEdges=2 keeps the two
// busiest edges and maxNodes=2 keeps edges among only two endpoints.
func TestTopologySnapshot_HonorsConfiguredServiceGraphLimits(t *testing.T) {
	totalBody := `{"data":[
		{"metric":{"client":"checkout","server":"payment"},"value":[1758800000,"30"]},
		{"metric":{"client":"checkout","server":"db"},"value":[1758800000,"20"]},
		{"metric":{"client":"cart","server":"cache"},"value":[1758800000,"10"]}
	]}`

	limits := PluginSettings{ServiceGraphMaxEdges: 2}
	server := newTopologySnapshotServer(t, new(atomic.Int32), totalBody, `{"data":[]}`, nil)
	defer server.Close()
	proxy := mcp.NewProxy(context.Background(), log.DefaultLogger)
	if err := proxy.EnsureServer(mcp.ServerConfig{
		ID: "mcp-grafana", Name: "Grafana", URL: server.URL, Type: "standard", Enabled: true,
	}); err != nil {
		t.Fatalf("failed to configure proxy: %v", err)
	}
	defer proxy.Close()

	p := &Plugin{logger: log.DefaultLogger, mcpProxy: proxy, settings: limits}
	snapshot := p.topologySnapshot(context.Background(), "", "1", "Org1", "")
	if got := countRenderedEdges(snapshot); got != 2 {
		t.Errorf("maxEdges=2 rendered %d edges:\n%s", got, snapshot)
	}
	if strings.Contains(snapshot, "cart -> cache") {
		t.Errorf("lowest-traffic edge must be cut by maxEdges=2:\n%s", snapshot)
	}

	// A fresh plugin and cache: maxNodes=2 allows only the first edge's two
	// endpoints, so the other edges are skipped.
	nodeLimitedProxy := mcp.NewProxy(context.Background(), log.DefaultLogger)
	if err := nodeLimitedProxy.EnsureServer(mcp.ServerConfig{
		ID: "mcp-grafana", Name: "Grafana", URL: server.URL, Type: "standard", Enabled: true,
	}); err != nil {
		t.Fatalf("failed to configure proxy: %v", err)
	}
	defer nodeLimitedProxy.Close()
	p = &Plugin{logger: log.DefaultLogger, mcpProxy: nodeLimitedProxy, settings: PluginSettings{ServiceGraphMaxNodes: 2}}
	snapshot = p.topologySnapshot(context.Background(), "", "1", "Org1", "")
	if got := countRenderedEdges(snapshot); got != 1 {
		t.Errorf("maxNodes=2 rendered %d edges, want 1:\n%s", got, snapshot)
	}
	if !strings.Contains(snapshot, "checkout -> payment") {
		t.Errorf("expected the busiest edge among two endpoints:\n%s", snapshot)
	}
}

func TestTopologySnapshot_CacheMissStored(t *testing.T) {
	// A proxy with no servers at all: every lookup fails, the snapshot is
	// empty — and the miss is cached so repeated runs don't re-pay it.
	proxy := mcp.NewProxy(context.Background(), log.DefaultLogger)
	defer proxy.Close()
	p := &Plugin{logger: log.DefaultLogger, mcpProxy: proxy}

	if got := p.topologySnapshot(context.Background(), "", "1", "Org1", ""); got != "" {
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

	checkout := p.topologySnapshot(context.Background(), `- Labels: service="checkout"`, "1", "Org1", "")
	if !strings.Contains(checkout, "checkout -> db") {
		t.Fatalf("expected checkout-scoped snapshot, got:\n%s", checkout)
	}

	// Same org, different service: a cache hit here would leak checkout's
	// neighborhood into payment's prompt.
	payment := p.topologySnapshot(context.Background(), `- Labels: service="payment"`, "1", "Org1", "")
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

	snapshot := p.topologySnapshot(context.Background(), "", "1", "Org1", "")
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

	snapshot := p.topologySnapshot(context.Background(), "", "1", "Org1", "")
	if !strings.Contains(snapshot, "api -> db (rps 5.00)") {
		t.Errorf("expected edge from the second Prometheus datasource, got:\n%s", snapshot)
	}
	if strings.Join(queried, ",") != "empty,central" {
		t.Errorf("queried datasources = %v, want [empty central] (loki skipped)", queried)
	}
}
