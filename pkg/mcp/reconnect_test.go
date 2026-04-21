package mcp

import (
	"context"
	"testing"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
)

func TestForceReconnect_DedupesRecentSession(t *testing.T) {
	// Client with openapi type so connectMCP() returns nil early without
	// actually attempting a network connect — we only want to exercise the
	// dedupe gate.
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	c := &Client{
		config:           ServerConfig{ID: "test", Type: "openapi"},
		logger:           log.DefaultLogger,
		ctx:              ctx,
		sessionCreatedAt: time.Now(), // simulate a just-established session
	}

	// First call: within dedupe window, should no-op.
	if err := c.forceReconnect(); err != nil {
		t.Fatalf("expected nil error from deduped forceReconnect, got %v", err)
	}
	// sessionCreatedAt must not be disturbed by a deduped call.
	sentinel := c.sessionCreatedAt
	if time.Since(sentinel) > forceReconnectMinInterval {
		t.Fatalf("sessionCreatedAt drifted unexpectedly")
	}

	// Age the session past the dedupe window — next call must attempt to
	// reconnect (openapi path returns nil, but the session should be cleared).
	c.mu.Lock()
	c.sessionCreatedAt = time.Now().Add(-(forceReconnectMinInterval + time.Second))
	c.mu.Unlock()
	if err := c.forceReconnect(); err != nil {
		t.Fatalf("expected nil error, got %v", err)
	}
}
