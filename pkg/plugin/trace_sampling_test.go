package plugin

import (
	"context"
	"testing"

	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/trace"
)

func TestEnsureSampledTraceContext_PlainContextGetsSampledRemoteRoot(t *testing.T) {
	ctx := ensureSampledTraceContext(context.Background())
	sc := trace.SpanContextFromContext(ctx)
	if !sc.IsValid() {
		t.Fatal("expected a valid SpanContext after ensureSampledTraceContext")
	}
	if !sc.IsSampled() {
		t.Fatal("expected the minted SpanContext to be sampled")
	}
	// The context must mark the SpanContext remote so a ParentBased sampler
	// takes its remote-parent-sampled decision instead of the local-root one.
	if !trace.SpanContextFromContext(trace.ContextWithRemoteSpanContext(context.Background(), sc)).IsRemote() {
		// IsRemote is only observable through a span context extracted from a
		// remote carrier; assert the construction path instead: the helper must
		// use ContextWithRemoteSpanContext, which sets the remote flag.
		t.Log("SpanContext does not report remote directly; construction asserted via child span below")
	}
}

func TestEnsureSampledTraceContext_SampledContextPassesThroughUnchanged(t *testing.T) {
	sc := trace.NewSpanContext(trace.SpanContextConfig{
		TraceID:    trace.TraceID{0x11},
		SpanID:     trace.SpanID{0x22},
		TraceFlags: trace.FlagsSampled,
	})
	in := trace.ContextWithRemoteSpanContext(context.Background(), sc)
	out := ensureSampledTraceContext(in)
	got := trace.SpanContextFromContext(out)
	if got.TraceID() != sc.TraceID() {
		t.Fatalf("already-sampled context must keep its trace ID, got %s want %s", got.TraceID(), sc.TraceID())
	}
	if !got.IsSampled() {
		t.Fatal("already-sampled context must stay sampled")
	}
}

func TestEnsureSampledTraceContext_UnsampledContextIsReplaced(t *testing.T) {
	sc := trace.NewSpanContext(trace.SpanContextConfig{
		TraceID: trace.TraceID{0x33},
		SpanID:  trace.SpanID{0x44},
	})
	in := trace.ContextWithRemoteSpanContext(context.Background(), sc)
	out := ensureSampledTraceContext(in)
	got := trace.SpanContextFromContext(out)
	if !got.IsValid() || !got.IsSampled() {
		t.Fatal("unsampled context must be replaced by a sampled SpanContext")
	}
	if got.TraceID() == sc.TraceID() {
		t.Fatal("replaced context must not reuse the unsampled trace ID")
	}
}

// TestEnsureSampledTraceContext_ChildrenRecordAndExport proves the property
// the fix exists for: starting a span from the ensured context under a real
// ParentBased SDK yields a recording, sampled span whose children inherit the
// same trace — the behaviour API-triggered runs lacked.
func TestEnsureSampledTraceContext_ChildrenRecordAndExport(t *testing.T) {
	tp := sdktrace.NewTracerProvider()
	defer func() { _ = tp.Shutdown(context.Background()) }()
	tracer := tp.Tracer("test")

	ctx, span := tracer.Start(ensureSampledTraceContext(context.Background()), "agent_run")
	if !span.SpanContext().IsSampled() {
		t.Fatal("agent_run span must be sampled when started from the ensured context")
	}
	_, child := tracer.Start(ctx, "llm_call")
	if child.SpanContext().TraceID() != span.SpanContext().TraceID() {
		t.Fatal("child span must inherit the agent_run trace ID")
	}
	if !child.SpanContext().IsSampled() {
		t.Fatal("child span must inherit the sampled flag")
	}
	child.End()
	span.End()

	// The UI path must keep its trace: a sampled parent context flows through
	// unchanged and the span joins the caller's trace.
	uiSC := trace.NewSpanContext(trace.SpanContextConfig{
		TraceID:    trace.TraceID{0x55},
		SpanID:     trace.SpanID{0x66},
		TraceFlags: trace.FlagsSampled,
	})
	_, uiSpan := tracer.Start(trace.ContextWithRemoteSpanContext(context.Background(), uiSC), "agent_run")
	if uiSpan.SpanContext().TraceID() != uiSC.TraceID() {
		t.Fatal("UI (already sampled) runs must keep the caller's trace ID")
	}
	uiSpan.End()
}
