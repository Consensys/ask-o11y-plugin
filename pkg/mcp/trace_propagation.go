package mcp

import (
	"net/http"

	"go.opentelemetry.io/otel/propagation"
)

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
	w3cPropagator.Inject(req.Context(), propagation.HeaderCarrier(req.Header))
	return t.base.RoundTrip(req)
}
