package plugin

import (
	"context"
	"crypto/rand"

	"go.opentelemetry.io/otel/trace"
)

// ensureSampledTraceContext guarantees that the agent run's trace is sampled.
//
// Grafana exports traces through the legacy `[tracing.opentelemetry.otlp]`
// path, whose head sampler keeps requests that arrive with a sampled remote
// parent (the browser sends one through Faro) but drops local-root traces
// (server-to-server callers such as the NOC alert trigger send no
// traceparent). The dropped decision propagates to every child span, so API
// runs produced zero exportable spans while UI runs from the same pods
// exported fully.
//
// When the incoming context carries no valid sampled SpanContext, this
// helper mints a fresh trace identity marked sampled and remote and attaches
// it to the context. A ParentBased sampler then applies its
// remote-parent-sampled decision — the same decision path the Faro requests
// ride — so the agent_run span records and exports regardless of what the
// caller propagated. Contexts that are already sampled pass through
// unchanged, preserving the shared trace with the browser or API caller.
func ensureSampledTraceContext(parent context.Context) context.Context {
	if sc := trace.SpanContextFromContext(parent); sc.IsValid() && sc.IsSampled() {
		return parent
	}

	var b [24]byte
	if _, err := rand.Read(b[:]); err != nil {
		// Refuse to fabricate a predictable trace identity: fall back to the
		// caller's context and accept the sampling decision it carries.
		return parent
	}
	sc := trace.NewSpanContext(trace.SpanContextConfig{
		TraceID:    trace.TraceID(b[0:16]),
		SpanID:     trace.SpanID(b[16:24]),
		TraceFlags: trace.FlagsSampled,
	})
	return trace.ContextWithRemoteSpanContext(parent, sc)
}
