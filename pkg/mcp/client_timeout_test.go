package mcp

import (
	"context"
	"testing"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
)

// TestClient_ToolCallTimeout covers the per-server tool-call budget: unset
// falls back to the historical 30s default, a configured value overrides it.
// Prod traces (2026-09-03..07) showed 47 calls pinned at the 30s ceiling
// (1,423s, 34% of tool time) because heavy Prometheus/Loki scans could not
// finish inside the old hard-coded budget.
func TestClient_ToolCallTimeout(t *testing.T) {
	c := &Client{config: ServerConfig{ID: "test"}, logger: log.DefaultLogger, ctx: context.Background()}
	if got := c.toolCallTimeout(); got != defaultToolCallTimeout {
		t.Fatalf("unset TimeoutSeconds should fall back to default; got %v", got)
	}

	c.config.TimeoutSeconds = 90
	if got := c.toolCallTimeout(); got != 90*time.Second {
		t.Fatalf("TimeoutSeconds=90 should yield 90s; got %v", got)
	}

	// Negative values are treated as unset (zero-value contract in
	// ServerConfig docs) rather than an immediately-expired context.
	c.config.TimeoutSeconds = -5
	if got := c.toolCallTimeout(); got != defaultToolCallTimeout {
		t.Fatalf("negative TimeoutSeconds should fall back to default; got %v", got)
	}
}
