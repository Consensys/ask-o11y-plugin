package mcp

import (
	"context"
	"net/http"

	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/trace"
)

// callerSpanContextKey carries the caller's SpanContext across mergeUserCtx,
// which rebuilds the tool-call context from the long-lived client context and
// copies only the user identity — dropping the caller's active span. Without
// this, the outgoing MCP request would have no span to propagate from.
type callerSpanContextKey struct{}

// WithCallerSpanContext attaches the caller's SpanContext to ctx so
// tracePropagationTransport can inject it after the context merge.
func WithCallerSpanContext(ctx context.Context, sc trace.SpanContext) context.Context {
	return context.WithValue(ctx, callerSpanContextKey{}, sc)
}

// callerSpanContextFromContext returns the caller SpanContext stashed by
// WithCallerSpanContext, if valid.
func callerSpanContextFromContext(ctx context.Context) (trace.SpanContext, bool) {
	sc, ok := ctx.Value(callerSpanContextKey{}).(trace.SpanContext)
	return sc, ok && sc.IsValid()
}

// tracePropagationTransport injects W3C trace context (traceparent/tracestate)
// from the request's span context into outgoing MCP requests.
//
// mcp-grafana reads an inbound traceparent header and parents its server span
// onto it, so asko11y's mcp_tool_call span, mcp-grafana's /mcp span, and the
// Grafana-core spans below it form one connected trace in Tempo. Without the
// injection each hop rooted its own trace and the tool-call could only be
// corroborated by correlating wall-clock windows across three disjoint
// traces.
//
// The W3C propagator is used directly instead of otel.GetTextMapPropagator():
// the global is replaced with an inert value by an SDK init in the plugin's
// import graph (verified by test: direct injection works where the global
// injects nothing), and mcp-grafana speaks W3C exclusively.
//
// Injection is a no-op when the request context carries no span, and extra
// headers are ignored by receivers that don't propagate.
type tracePropagationTransport struct {
	base http.RoundTripper
}

var w3cPropagator = propagation.TraceContext{}

func (t *tracePropagationTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	ctx := req.Context()
	if sc, ok := callerSpanContextFromContext(ctx); ok {
		// Preferred path: the caller's span stashed across mergeUserCtx.
		ctx = trace.ContextWithRemoteSpanContext(ctx, sc)
	} else if sc := trace.SpanContextFromContext(ctx); sc.IsValid() {
		// Fallback: contexts that were never rebuilt by mergeUserCtx carry
		// their span directly.
		ctx = trace.ContextWithSpanContext(ctx, sc)
	}
	// http.RoundTripper must not mutate the caller's request: clone with the
	// (possibly span-enriched) context and inject into the copy.
	clone := req.Clone(ctx)
	w3cPropagator.Inject(clone.Context(), propagation.HeaderCarrier(clone.Header))
	return t.base.RoundTrip(clone)
}
