package mcp

import (
	"testing"
	"time"
)

func TestCacheableTTL(t *testing.T) {
	if ttl, ok := cacheableTTL("grafana_list_prometheus_metric_names"); !ok || ttl <= 0 {
		t.Fatalf("expected grafana_list_prometheus_metric_names to be cacheable with a positive TTL, got ttl=%v ok=%v", ttl, ok)
	}
	if _, ok := cacheableTTL("otherserver_list_prometheus_metric_names"); !ok {
		t.Fatal("expected cacheableTTL to match on tool-name suffix regardless of server id prefix")
	}
	if _, ok := cacheableTTL("grafana_query_prometheus"); ok {
		t.Fatal("expected grafana_query_prometheus not to be cacheable")
	}
}

func TestResultCache_GetSetRoundTrip(t *testing.T) {
	c := newResultCache()
	key := cacheKey("grafana_list_prometheus_metric_names", "24", "", 1, map[string]interface{}{"regex": ".*"})

	if _, hit := c.get(key); hit {
		t.Fatal("expected cache miss before any set")
	}

	want := &CallToolResult{Content: []ContentBlock{{Type: "text", Text: "metric_a\nmetric_b"}}}
	c.set(key, want, time.Minute)

	got, hit := c.get(key)
	if !hit {
		t.Fatal("expected cache hit after set")
	}
	if got != want {
		t.Fatalf("expected cached result to be the same pointer set, got a different value: %+v", got)
	}
}

func TestResultCache_ExpiresAfterTTL(t *testing.T) {
	c := newResultCache()
	key := cacheKey("grafana_list_prometheus_metric_names", "24", "", 1, map[string]interface{}{"regex": ".*"})

	c.set(key, &CallToolResult{Content: []ContentBlock{{Type: "text", Text: "x"}}}, 1*time.Millisecond)
	time.Sleep(5 * time.Millisecond)

	if _, hit := c.get(key); hit {
		t.Fatal("expected cache entry to have expired")
	}
}

func TestCacheKey_ScopesAcrossOrgUserAndArguments(t *testing.T) {
	base := cacheKey("grafana_list_prometheus_metric_names", "24", "", 1, map[string]interface{}{"regex": ".*"})

	cases := map[string]string{
		"different org":       cacheKey("grafana_list_prometheus_metric_names", "38", "", 1, map[string]interface{}{"regex": ".*"}),
		"different user":      cacheKey("grafana_list_prometheus_metric_names", "24", "", 2, map[string]interface{}{"regex": ".*"}),
		"different arguments": cacheKey("grafana_list_prometheus_metric_names", "24", "", 1, map[string]interface{}{"regex": "aws_.*"}),
		"different scope org": cacheKey("grafana_list_prometheus_metric_names", "24", "38", 1, map[string]interface{}{"regex": ".*"}),
	}
	for name, key := range cases {
		if key == base {
			t.Errorf("expected %s to produce a distinct cache key, but it matched the base key", name)
		}
	}

	// Identical inputs, including map key insertion order, must produce the
	// same key (json.Marshal on map[string]interface{} sorts keys).
	same := cacheKey("grafana_list_prometheus_metric_names", "24", "", 1, map[string]interface{}{"regex": ".*"})
	if same != base {
		t.Fatalf("expected identical inputs to produce the same cache key: %q != %q", same, base)
	}
}
