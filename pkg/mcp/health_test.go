package mcp

import (
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
