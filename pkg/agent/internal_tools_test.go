package agent

import (
	"context"
	"testing"

	"consensys-asko11y-app/pkg/mcp"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
)

func TestInternalToolSpecRendersFunctionDefinition(t *testing.T) {
	tool := InternalTool{
		Name:        "spawn_session",
		Description: "Spawns a session.",
		Parameters: map[string]interface{}{
			"type":       "object",
			"properties": map[string]interface{}{},
			"required":   []string{"skill"},
		},
	}
	spec := tool.spec()
	if spec.Type != "function" || spec.Function.Name != "spawn_session" {
		t.Fatalf("unexpected spec: %+v", spec)
	}
	if spec.Function.Description != "Spawns a session." {
		t.Fatalf("description not rendered: %q", spec.Function.Description)
	}
	if spec.Function.Parameters == nil {
		t.Fatal("parameters not rendered")
	}
}

func TestLoopRequestInternalToolLookup(t *testing.T) {
	req := LoopRequest{InternalTools: []InternalTool{{Name: "share_session"}}}
	if _, ok := req.internalTool("share_session"); !ok {
		t.Fatal("expected to find injected tool")
	}
	if _, ok := req.internalTool("spawn_session"); ok {
		t.Fatal("spawn_session must not resolve when not injected")
	}
	empty := LoopRequest{}
	if _, ok := empty.internalTool("share_session"); ok {
		t.Fatal("no tool must resolve on an empty request")
	}
}

func TestLoopRequestAllowTool(t *testing.T) {
	req := LoopRequest{AllowToolNames: []string{"a_query", "b_query"}}
	if !req.allowTool("a_query") || !req.allowTool("b_query") {
		t.Fatal("allowlisted names must pass")
	}
	if req.allowTool("c_write") {
		t.Fatal("non-allowlisted name must be refused")
	}
	if !(LoopRequest{}).allowTool("anything") {
		t.Fatal("an empty allowlist allows every tool (interactive runs)")
	}
}

func TestFilterToolsByAllowlist(t *testing.T) {
	tools := []mcp.Tool{
		{Name: "srv_one"}, {Name: "srv_two"}, {Name: "srv_three"},
	}
	got := filterToolsByAllowlist(tools, []string{"srv_one", "srv_three"})
	if len(got) != 2 || got[0].Name != "srv_one" || got[1].Name != "srv_three" {
		t.Fatalf("allowlist filter kept the wrong set: %+v", got)
	}
	if all := filterToolsByAllowlist(tools, nil); len(all) != len(tools) {
		t.Fatalf("empty allowlist must keep every tool, got %d", len(all))
	}
	if none := filterToolsByAllowlist(tools, []string{"missing"}); len(none) != 0 {
		t.Fatalf("unknown allowlist must keep nothing, got %d", len(none))
	}
}

func TestExecuteInternalToolSuccessAndError(t *testing.T) {
	a := NewAgentLoop(nil, nil, log.DefaultLogger)

	okTool := InternalTool{Name: "ok", Handler: func(context.Context, string) (string, bool) {
		return "done", false
	}}
	content, isError, errorKind := a.executeInternalTool(context.Background(), ToolCall{
		Function: FunctionCall{Name: "ok", Arguments: "{}"},
	}, okTool)
	if content != "done" || isError || errorKind != "" {
		t.Fatalf("success path broken: %q %v %q", content, isError, errorKind)
	}

	errTool := InternalTool{Name: "bad", Handler: func(context.Context, string) (string, bool) {
		return "capacity reached", true
	}}
	content, isError, errorKind = a.executeInternalTool(context.Background(), ToolCall{
		Function: FunctionCall{Name: "bad", Arguments: "{}"},
	}, errTool)
	if content != "capacity reached" || !isError || errorKind != "tool" {
		t.Fatalf("error path broken: %q %v %q", content, isError, errorKind)
	}

	emptyTool := InternalTool{Name: "quiet", Handler: func(context.Context, string) (string, bool) {
		return "", false
	}}
	content, _, _ = a.executeInternalTool(context.Background(), ToolCall{
		Function: FunctionCall{Name: "quiet", Arguments: "{}"},
	}, emptyTool)
	if content == "" {
		t.Fatal("empty handler output must default to a visible placeholder")
	}
}
