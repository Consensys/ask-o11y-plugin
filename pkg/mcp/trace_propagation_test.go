package mcp

import (
	"context"
	"net/http"
	"strings"
	"testing"

	sdktrace "go.opentelemetry.io/otel/sdk/trace"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) { return f(req) }

// TestTracePropagationTransport_InjectsTraceparent verifies that a request
// made inside an active span carries a W3C traceparent header whose span ID
// is that span — mcp-grafana parents its server span onto it, stitching
// asko11y -> mcp-grafana -> Grafana core into one trace.
func TestTracePropagationTransport_InjectsTraceparent(t *testing.T) {
	tp := sdktrace.NewTracerProvider()
	defer func() { _ = tp.Shutdown(context.Background()) }()

	ctx, span := tp.Tracer("test").Start(context.Background(), "mcp_tool_call")
	defer span.End()

	var got http.Header
	base := roundTripFunc(func(req *http.Request) (*http.Response, error) {
		got = req.Header.Clone()
		return &http.Response{StatusCode: 200, Header: http.Header{}, Body: http.NoBody}, nil
	})

	req := (&http.Request{Method: "POST", Header: http.Header{}}).WithContext(ctx)
	resp, err := (&tracePropagationTransport{base: base}).RoundTrip(req)
	if err != nil {
		t.Fatal(err)
	}
	tpHeader := got.Get("Traceparent")
	if tpHeader == "" {
		t.Fatal("expected traceparent header to be injected")
	}
	parts := strings.Split(tpHeader, "-")
	if len(parts) != 4 || parts[0] != "00" {
		t.Fatalf("malformed traceparent %q", tpHeader)
	}
	if parts[2] != span.SpanContext().SpanID().String() {
		t.Fatalf("traceparent span ID %s should match the active span %s", parts[2], span.SpanContext().SpanID().String())
	}
	if resp == nil {
		t.Fatal("expected a response")
	}
}

// TestTracePropagationTransport_NoSpan makes sure a span-less context is not
// polluted with a fake traceparent — receivers must keep rooting their own
// traces in that case.
func TestTracePropagationTransport_NoSpan(t *testing.T) {
	var got http.Header
	base := roundTripFunc(func(req *http.Request) (*http.Response, error) {
		got = req.Header.Clone()
		return &http.Response{StatusCode: 200, Header: http.Header{}, Body: http.NoBody}, nil
	})

	req := (&http.Request{Method: "POST", Header: http.Header{}}).WithContext(context.Background())
	if _, err := (&tracePropagationTransport{base: base}).RoundTrip(req); err != nil {
		t.Fatal(err)
	}
	if got.Get("Traceparent") != "" {
		t.Fatal("no active span: traceparent must not be injected")
	}
}
