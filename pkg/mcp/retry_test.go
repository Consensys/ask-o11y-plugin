package mcp

import (
	"context"
	"errors"
	"io"
	"sync/atomic"
	"testing"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
)

// retryTestClient builds a Client stripped down to just the fields the retry
// loop reads. Spinning up a full MCP session would drag in the SDK's HTTP
// handshake; the retry wrapper is a pure function that only depends on ctx,
// logger, and the injected callToolOncer.
func retryTestClient(ctx context.Context) *Client {
	return &Client{
		config: ServerConfig{ID: "test"},
		logger: log.DefaultLogger,
		ctx:    ctx,
	}
}

func TestRetry_TransientTransportFailureThenSuccess(t *testing.T) {
	var calls atomic.Int32
	once := func(toolName string, args map[string]interface{}, orgID, orgName, scope string) (*CallToolResult, error) {
		n := calls.Add(1)
		if n == 1 {
			return nil, io.ErrUnexpectedEOF
		}
		return &CallToolResult{Content: []ContentBlock{{Type: "text", Text: "ok"}}}, nil
	}

	c := retryTestClient(context.Background())
	start := time.Now()
	res, err := c.callMCPToolWithRetry(once, "t", nil, "", "", "")
	elapsed := time.Since(start)
	if err != nil {
		t.Fatalf("expected success after retry, got err %v", err)
	}
	if res == nil || len(res.Content) == 0 {
		t.Fatalf("expected result")
	}
	if calls.Load() != 2 {
		t.Fatalf("expected 2 calls (1 fail + 1 success), got %d", calls.Load())
	}
	// At least one backoff interval should have elapsed (≈ 100ms * (1 - 0.3)).
	if elapsed < 50*time.Millisecond {
		t.Fatalf("expected some backoff delay; elapsed=%v", elapsed)
	}
}

func TestRetry_PermanentTransportExhausts(t *testing.T) {
	var calls atomic.Int32
	once := func(toolName string, args map[string]interface{}, orgID, orgName, scope string) (*CallToolResult, error) {
		calls.Add(1)
		return nil, errors.New("connection refused")
	}

	c := retryTestClient(context.Background())
	res, err := c.callMCPToolWithRetry(once, "t", nil, "", "", "")
	if err == nil {
		t.Fatal("expected error after exhaustion")
	}
	var te *TransportError
	if !errors.As(err, &te) {
		t.Fatalf("expected *TransportError, got %T: %v", err, err)
	}
	if res != nil {
		t.Fatalf("expected nil result on exhaustion, got %+v", res)
	}
	expectedAttempts := len(retrySchedule) + 1 // initial attempt + retries
	if got := calls.Load(); got != int32(expectedAttempts) {
		t.Fatalf("expected %d attempts, got %d", expectedAttempts, got)
	}
}

func TestRetry_ProtocolErrorNotRetried(t *testing.T) {
	var calls atomic.Int32
	once := func(toolName string, args map[string]interface{}, orgID, orgName, scope string) (*CallToolResult, error) {
		calls.Add(1)
		return nil, errors.New("unauthorized")
	}

	c := retryTestClient(context.Background())
	_, err := c.callMCPToolWithRetry(once, "t", nil, "", "", "")
	if err == nil {
		t.Fatal("expected error")
	}
	if calls.Load() != 1 {
		t.Fatalf("expected 1 attempt for protocol error, got %d", calls.Load())
	}
	var te *TransportError
	if errors.As(err, &te) {
		t.Fatalf("protocol error should NOT be wrapped in TransportError")
	}
}

func TestRetry_ContextCancelStopsBackoff(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	var calls atomic.Int32
	once := func(toolName string, args map[string]interface{}, orgID, orgName, scope string) (*CallToolResult, error) {
		n := calls.Add(1)
		if n == 1 {
			// Cancel the context mid-first-attempt so the retry loop trips ctx.Done
			// inside the first backoff sleep.
			cancel()
		}
		return nil, io.EOF
	}

	c := retryTestClient(ctx)
	start := time.Now()
	_, err := c.callMCPToolWithRetry(once, "t", nil, "", "", "")
	elapsed := time.Since(start)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("expected context.Canceled, got %v", err)
	}
	// Should not have waited a full 100ms if ctx was cancelled early.
	if elapsed > 50*time.Millisecond {
		t.Fatalf("expected fast cancel, elapsed=%v", elapsed)
	}
	if calls.Load() != 1 {
		t.Fatalf("expected only 1 attempt before cancel, got %d", calls.Load())
	}
}

func TestRetry_ToolLogicErrorNeverSeenByRetry(t *testing.T) {
	// The MCP SDK signals tool logic errors via result.IsError=true with err=nil,
	// so the retry loop shouldn't treat that as a retry trigger. Simulate here.
	var calls atomic.Int32
	once := func(toolName string, args map[string]interface{}, orgID, orgName, scope string) (*CallToolResult, error) {
		calls.Add(1)
		return &CallToolResult{IsError: true, Content: []ContentBlock{{Type: "text", Text: "bad input"}}}, nil
	}

	c := retryTestClient(context.Background())
	res, err := c.callMCPToolWithRetry(once, "t", nil, "", "", "")
	if err != nil {
		t.Fatalf("tool logic error should come back with nil err, got %v", err)
	}
	if res == nil || !res.IsError {
		t.Fatalf("expected tool-layer error result")
	}
	if calls.Load() != 1 {
		t.Fatalf("expected 1 attempt for tool logic error, got %d", calls.Load())
	}
}

func TestJitteredDuration_BoundsAreRespected(t *testing.T) {
	base := 100 * time.Millisecond
	for i := 0; i < 500; i++ {
		d := jitteredDuration(base, 0.30)
		if d < 70*time.Millisecond || d > 130*time.Millisecond {
			t.Fatalf("jitter out of bounds: %v", d)
		}
	}
	if d := jitteredDuration(base, 0); d != base {
		t.Fatalf("zero fraction should return base; got %v", d)
	}
}
