package mcp

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
)

// TestEffectiveResponseLimit covers the 32 MiB hard ceiling. Grafana's
// configured limit wins when it is set and tighter; the ceiling applies when
// nothing is configured, because the SDK treats 0 as "no limit".
func TestEffectiveResponseLimit(t *testing.T) {
	t.Setenv("GF_DATAPROXY_RESPONSE_LIMIT", "")
	if got := effectiveResponseLimit(context.Background()); got != maxMCPResponseBytes {
		t.Fatalf("unset limit should fall back to %d, got %d", maxMCPResponseBytes, got)
	}

	t.Setenv("GF_DATAPROXY_RESPONSE_LIMIT", "1024")
	if got := effectiveResponseLimit(context.Background()); got != 1024 {
		t.Fatalf("env limit should win, got %d", got)
	}

	t.Setenv("GF_DATAPROXY_RESPONSE_LIMIT", "999999999999")
	if got := effectiveResponseLimit(context.Background()); got != maxMCPResponseBytes {
		t.Fatalf("limit above the ceiling must clamp to %d, got %d", maxMCPResponseBytes, got)
	}

	t.Setenv("GF_DATAPROXY_RESPONSE_LIMIT", "not-a-number")
	if got := effectiveResponseLimit(context.Background()); got != maxMCPResponseBytes {
		t.Fatalf("unparsable limit should fall back to the ceiling, got %d", got)
	}
}

func TestReadBounded(t *testing.T) {
	if _, err := readBounded(strings.NewReader("hello"), 10); err != nil {
		t.Fatalf("body under the limit should pass: %v", err)
	}
	if got, err := readBounded(strings.NewReader("0123456789"), 10); err != nil || string(got) != "0123456789" {
		t.Fatalf("body exactly at the limit should pass: %q %v", got, err)
	}
	_, err := readBounded(strings.NewReader("01234567890"), 10)
	if err == nil || !strings.Contains(err.Error(), "exceeds") {
		t.Fatalf("body over the limit must fail, got %v", err)
	}
}

// TestListStandardToolsUsesCallerContext guards the Grafana finding: the
// request context must reach http.NewRequestWithContext so cancellation
// propagates instead of being swallowed by a background request.
func TestListStandardToolsUsesCallerContext(t *testing.T) {
	started := make(chan struct{})
	release := make(chan struct{})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(started)
		// Held open until the test cancels, then released so srv.Close cannot
		// wedge. The client must give up on its own, without the server's help.
		<-release
	}))
	defer srv.Close()
	defer close(release)

	c := &Client{
		config:     ServerConfig{ID: "s", URL: srv.URL, Type: "standard"},
		logger:     log.DefaultLogger,
		ctx:        context.Background(),
		httpClient: srv.Client(),
	}

	ctx, cancel := context.WithCancel(context.Background())
	errCh := make(chan error, 1)
	go func() {
		_, err := c.listStandardTools(ctx)
		errCh <- err
	}()

	select {
	case <-started:
	case <-time.After(2 * time.Second):
		t.Fatal("server never received the list-tools request")
	}
	cancel()

	select {
	case err := <-errCh:
		if err == nil {
			t.Fatal("cancelled context should surface an error")
		}
	case <-time.After(3 * time.Second):
		t.Fatal("cancellation did not propagate to the HTTP client")
	}
}

// TestCallStandardToolUsesCallerContext covers the same contract on the
// tool-call path.
func TestCallStandardToolUsesCallerContext(t *testing.T) {
	var gotBody bytes.Buffer
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = gotBody.ReadFrom(r.Body)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"content":[{"type":"text","text":"ok"}]}`))
	}))
	defer srv.Close()

	c := &Client{
		config:     ServerConfig{ID: "s", URL: srv.URL, Type: "standard"},
		logger:     log.DefaultLogger,
		ctx:        context.Background(),
		httpClient: srv.Client(),
	}

	res, err := c.callStandardTool(context.Background(), "tool", map[string]interface{}{"a": 1})
	if err != nil {
		t.Fatalf("call: %v", err)
	}
	if res == nil || len(res.Content) == 0 || res.Content[0].Text != "ok" {
		t.Fatalf("unexpected result: %+v", res)
	}
	if !strings.Contains(gotBody.String(), `"tools/call"`) {
		t.Fatalf("request body missing method: %s", gotBody.String())
	}
}

// TestCallOpenAPIToolCapsResponseBody drives the readBounded path end to end:
// a response above the resolved limit must fail instead of buffering forever.
func TestCallOpenAPIToolCapsResponseBody(t *testing.T) {
	t.Setenv("GF_DATAPROXY_RESPONSE_LIMIT", "16")

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(bytes.Repeat([]byte("x"), 1024))
	}))
	defer srv.Close()

	c := &Client{
		config: ServerConfig{ID: "s", URL: srv.URL, Type: "openapi"},
		logger: log.DefaultLogger,
		ctx:    context.Background(),
		operationMetadata: map[string]OperationMetadata{
			"thing": {Path: "/thing", Method: http.MethodGet},
		},
		httpClient: srv.Client(),
	}

	_, err := c.callOpenAPIToolWithContext(context.Background(), "thing", map[string]interface{}{}, "", "", "")
	if err == nil || !strings.Contains(err.Error(), "exceeds") {
		t.Fatalf("response over the configured limit must be rejected, got %v", err)
	}
}
