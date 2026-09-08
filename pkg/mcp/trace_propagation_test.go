package mcp

import (
	"context"
	"net/http"
	"strings"
	"testing"

	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/trace"
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
	resp, err := (&tracePropagationTransport{base: base}).RoundTrip(req)
	if err != nil {
		t.Fatal(err)
	}
	if got.Get("Traceparent") != "" {
		t.Fatal("no active span: traceparent must not be injected")
	}
	if resp != nil && resp.Request != nil && resp.Request != req && resp.Request.Header.Get("Traceparent") != "" {
		// resp.Request is set by the http.Client layer, not raw transports —
		// nothing to assert here; kept as a guard against accidental mutation.
		t.Fatal("caller request must not be mutated")
	}
	if req.Header.Get("Traceparent") != "" {
		t.Fatal("RoundTrip must not mutate the caller's request headers")
	}
}

// TestTracePropagationTransport_MergedContextCallerSpan regression-covers the
// Bugbot finding: CallTool rebuilds its context via mergeUserCtx, which
// copies only the user ID and drops the caller's active span. The caller's
// SpanContext must travel via WithCallerSpanContext and the injected
// traceparent must reference it.
func TestTracePropagationTransport_MergedContextCallerSpan(t *testing.T) {
	tp := sdktrace.NewTracerProvider()
	defer func() { _ = tp.Shutdown(context.Background()) }()

	callerCtx, callerSpan := tp.Tracer("test").Start(context.Background(), "mcp_tool_call")
	defer callerSpan.End()

	// Simulate mergeUserCtx: brand-new context carrying only a user value.
	merged := context.Background()
	if !trace.SpanContextFromContext(merged).IsValid() && trace.SpanContextFromContext(callerCtx).IsValid() {
		merged = WithCallerSpanContext(merged, trace.SpanContextFromContext(callerCtx))
	}

	var got http.Header
	base := roundTripFunc(func(req *http.Request) (*http.Response, error) {
		got = req.Header.Clone()
		return &http.Response{StatusCode: 200, Header: http.Header{}, Body: http.NoBody}, nil
	})

	req := (&http.Request{Method: "POST", Header: http.Header{}}).WithContext(merged)
	if _, err := (&tracePropagationTransport{base: base}).RoundTrip(req); err != nil {
		t.Fatal(err)
	}
	tpHeader := got.Get("Traceparent")
	if tpHeader == "" {
		t.Fatal("caller span stashed via WithCallerSpanContext must be injected even after the context merge")
	}
	parts := strings.Split(tpHeader, "-")
	if len(parts) != 4 {
		t.Fatalf("malformed traceparent %q", tpHeader)
	}
	if parts[2] != callerSpan.SpanContext().SpanID().String() {
		t.Fatalf("traceparent %q should reference the caller span %s", tpHeader, callerSpan.SpanContext().SpanID())
	}
}

// TestTracePropagationTransport_EnrichesContextForInnerMiddleware asserts the
// full-chain behavior: the transport hands the INNER middleware a context
// whose active span is the caller's (as a remote parent), so the middleware's
// own "HTTP Outgoing Request" span becomes a child of mcp_tool_call and the
// chain grafana-frontend -> agent_run -> mcp_tool_call -> HTTP Outgoing ->
// mcp-grafana stays in one trace instead of re-rooting at the middleware.
func TestTracePropagationTransport_EnrichesContextForInnerMiddleware(t *testing.T) {
	tp := sdktrace.NewTracerProvider()
	defer func() { _ = tp.Shutdown(context.Background()) }()

	callerCtx, callerSpan := tp.Tracer("test").Start(context.Background(), "mcp_tool_call")
	defer callerSpan.End()

	// Merged context: no live span, only the stash (mergeUserCtx result).
	merged := WithCallerSpanContext(context.Background(), trace.SpanContextFromContext(callerCtx))

	var innerCtx context.Context
	base := roundTripFunc(func(req *http.Request) (*http.Response, error) {
		innerCtx = req.Context()
		return &http.Response{StatusCode: 200, Header: http.Header{}, Body: http.NoBody}, nil
	})

	req := (&http.Request{Method: "POST", Header: http.Header{}}).WithContext(merged)
	if _, err := (&tracePropagationTransport{base: base}).RoundTrip(req); err != nil {
		t.Fatal(err)
	}

	inner := trace.SpanContextFromContext(innerCtx)
	if !inner.IsValid() {
		t.Fatal("inner middleware should receive a context with an active (remote caller) span")
	}
	if inner.TraceID() != callerSpan.SpanContext().TraceID() {
		t.Fatalf("inner span trace %s should match the caller trace %s", inner.TraceID(), callerSpan.SpanContext().TraceID())
	}
	if inner.SpanID() != callerSpan.SpanContext().SpanID() {
		t.Fatalf("inner span parent should be the caller span %s, got %s", callerSpan.SpanContext().SpanID(), inner.SpanID())
	}
}
