package mcp

import (
	"errors"
	"testing"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
)

func newTestHealthMonitor() *HealthMonitor {
	proxy := &Proxy{
		clients: make(map[string]*Client),
		logger:  log.DefaultLogger,
	}
	monitor := NewHealthMonitor(proxy, log.DefaultLogger)
	proxy.healthMonitor = monitor
	return monitor
}

func TestHealthMonitor_StopBeforeStartReturns(t *testing.T) {
	monitor := newTestHealthMonitor()

	done := make(chan struct{})
	go func() {
		monitor.Stop()
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("Stop blocked when Start never ran")
	}
}

func TestHealthMonitor_RepeatedStopIsSafe(t *testing.T) {
	monitor := newTestHealthMonitor()
	monitor.Start(time.Hour)
	monitor.Start(time.Hour)
	monitor.Stop()
	monitor.Stop()
}

func TestHealthMonitor_RemoveServerForgetsHealth(t *testing.T) {
	monitor := newTestHealthMonitor()
	monitor.mu.Lock()
	monitor.health["gone"] = &ServerHealth{ServerID: "gone"}
	monitor.mu.Unlock()

	monitor.RemoveServer("gone")

	if got := len(monitor.GetAllHealth()); got != 0 {
		t.Errorf("health entries = %d, want 0", got)
	}
}

// A probe that is already in flight when the server disappears must not put the
// row back. The probe captures the generation before the network call, and
// RemoveServer bumps it.
func TestHealthMonitor_RemoveServerDropsInFlightResult(t *testing.T) {
	monitor := newTestHealthMonitor()
	client := &Client{config: ServerConfig{ID: "srv", Name: "Srv", URL: "http://srv", Type: "streamable-http"}}

	monitor.mu.RLock()
	generation := monitor.generation
	monitor.mu.RUnlock()

	monitor.RemoveServer("srv")

	monitor.recordHealth("srv", client, generation, nil, 5, nil)

	if got := len(monitor.GetAllHealth()); got != 0 {
		t.Fatalf("health entries = %d, want 0: a stale probe recreated a removed server", got)
	}
}

func TestHealthMonitor_RecordHealthCountsChecks(t *testing.T) {
	monitor := newTestHealthMonitor()
	client := &Client{config: ServerConfig{ID: "srv", Name: "Srv", URL: "http://srv", Type: "streamable-http"}}
	tools := []Tool{{Name: "srv_one"}, {Name: "srv_two"}}

	monitor.mu.RLock()
	generation := monitor.generation
	monitor.mu.RUnlock()

	monitor.recordHealth("srv", client, generation, tools, 12, nil)
	monitor.recordHealth("srv", client, generation, nil, 5, errors.New("boom"))

	health := monitor.GetAllHealth()
	if len(health) != 1 {
		t.Fatalf("health entries = %d, want 1", len(health))
	}
	got := health[0]
	if got.TotalChecks != 2 || got.ErrorCount != 1 {
		t.Errorf("checks = %d, errors = %d; want 2, 1", got.TotalChecks, got.ErrorCount)
	}
	if got.SuccessRate != 50 {
		t.Errorf("successRate = %v, want 50", got.SuccessRate)
	}
	if got.ToolCount != 2 {
		t.Errorf("toolCount = %d, want 2 after the successful probe", got.ToolCount)
	}
}
