package mcp

import (
	"context"
	"sync/atomic"
	"testing"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
)

func TestEnsureServerClosesReplacedClientOutsideLock(t *testing.T) {
	proxy := NewProxy(context.Background(), log.DefaultLogger)
	serverID := "mcp-grafana"

	closeStarted := make(chan struct{})
	releaseClose := make(chan struct{})

	existing := &Client{
		config: ServerConfig{
			ID:      serverID,
			URL:     "http://old.example",
			Headers: map[string]string{"Authorization": "Bearer old"},
		},
		cancel: func() {
			close(closeStarted)
			<-releaseClose
		},
	}

	proxy.mu.Lock()
	proxy.clients[serverID] = existing
	proxy.mu.Unlock()

	ensureDone := make(chan struct{})
	go func() {
		proxy.EnsureServer(ServerConfig{
			ID:      serverID,
			URL:     "http://new.example",
			Type:    "streamable-http",
			Enabled: true,
			Headers: map[string]string{"Authorization": "Bearer new"},
		})
		close(ensureDone)
	}()

	select {
	case <-closeStarted:
	case <-time.After(1 * time.Second):
		t.Fatal("expected replaced client close to start")
	}

	// EnsureServer should not hold proxy.mu while close is blocked.
	countDone := make(chan int, 1)
	go func() {
		countDone <- proxy.GetServerCount()
	}()

	select {
	case count := <-countDone:
		if count != 1 {
			t.Fatalf("expected exactly one server, got %d", count)
		}
	case <-time.After(200 * time.Millisecond):
		t.Fatal("proxy lock appears blocked while closing replaced client")
	}

	proxy.mu.RLock()
	current := proxy.clients[serverID]
	proxy.mu.RUnlock()

	if current == nil {
		t.Fatal("expected ensured client to be present")
	}
	if current == existing {
		t.Fatal("expected EnsureServer to replace existing client")
	}
	if current.config.URL != "http://new.example" {
		t.Fatalf("expected new URL %q, got %q", "http://new.example", current.config.URL)
	}

	close(releaseClose)

	select {
	case <-ensureDone:
	case <-time.After(1 * time.Second):
		t.Fatal("EnsureServer did not finish after close was unblocked")
	}
}

func TestEnsureServerNoopWhenConfigMatchesExisting(t *testing.T) {
	proxy := NewProxy(context.Background(), log.DefaultLogger)
	serverID := "mcp-grafana"

	var closeCalled atomic.Bool
	existing := &Client{
		config: ServerConfig{
			ID:      serverID,
			URL:     "http://same.example",
			Headers: map[string]string{"Authorization": "Bearer same"},
		},
		cancel: func() {
			closeCalled.Store(true)
		},
	}

	proxy.mu.Lock()
	proxy.clients[serverID] = existing
	proxy.mu.Unlock()

	proxy.EnsureServer(ServerConfig{
		ID:      serverID,
		URL:     "http://same.example",
		Type:    "streamable-http",
		Enabled: true,
		Headers: map[string]string{"Authorization": "Bearer same"},
	})

	if closeCalled.Load() {
		t.Fatal("did not expect EnsureServer to close unchanged client")
	}

	proxy.mu.RLock()
	current := proxy.clients[serverID]
	proxy.mu.RUnlock()

	if current != existing {
		t.Fatal("expected existing client to be kept when config is unchanged")
	}
}
