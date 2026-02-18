package openapi

import (
	"encoding/json"
	"testing"
)

func TestSpecIsValidJSON(t *testing.T) {
	var spec map[string]interface{}
	if err := json.Unmarshal(specJSON, &spec); err != nil {
		t.Fatalf("OpenAPI spec is not valid JSON: %v", err)
	}

	if spec["openapi"] != "3.0.3" {
		t.Errorf("Expected openapi version 3.0.3, got %v", spec["openapi"])
	}

	info, ok := spec["info"].(map[string]interface{})
	if !ok || info["title"] == nil || info["version"] == nil {
		t.Error("OpenAPI spec missing required info fields (title, version)")
	}
}

func TestGetSpec(t *testing.T) {
	spec, err := GetSpec()
	if err != nil {
		t.Fatalf("GetSpec() failed: %v", err)
	}

	if spec == nil {
		t.Fatal("GetSpec() returned nil spec")
	}

	if spec["openapi"] != "3.0.3" {
		t.Errorf("Expected openapi version 3.0.3, got %v", spec["openapi"])
	}
}

func TestGetSpecBytes(t *testing.T) {
	bytes := GetSpecBytes()
	if bytes == nil || len(bytes) == 0 {
		t.Fatal("GetSpecBytes() returned empty bytes")
	}

	var spec map[string]interface{}
	if err := json.Unmarshal(bytes, &spec); err != nil {
		t.Fatalf("GetSpecBytes() returned invalid JSON: %v", err)
	}
}

func TestSpecHasRequiredFields(t *testing.T) {
	spec, err := GetSpec()
	if err != nil {
		t.Fatalf("GetSpec() failed: %v", err)
	}

	requiredTopLevel := []string{"openapi", "info", "paths", "components"}
	for _, field := range requiredTopLevel {
		if spec[field] == nil {
			t.Errorf("OpenAPI spec missing required top-level field: %s", field)
		}
	}

	info, ok := spec["info"].(map[string]interface{})
	if !ok {
		t.Fatal("OpenAPI spec info field is not an object")
	}

	requiredInfoFields := []string{"title", "version", "description"}
	for _, field := range requiredInfoFields {
		if info[field] == nil {
			t.Errorf("OpenAPI spec info missing required field: %s", field)
		}
	}
}

func TestSpecHasAllEndpoints(t *testing.T) {
	spec, err := GetSpec()
	if err != nil {
		t.Fatalf("GetSpec() failed: %v", err)
	}

	paths, ok := spec["paths"].(map[string]interface{})
	if !ok {
		t.Fatal("OpenAPI spec paths field is not an object")
	}

	expectedPaths := []string{
		"/health",
		"/",
		"/openapi.json",
		"/mcp",
		"/api/mcp/tools",
		"/api/mcp/call-tool",
		"/api/mcp/servers",
		"/api/agent/run",
		"/api/agent/runs/{runId}",
		"/api/agent/runs/{runId}/events",
		"/api/agent/runs/{runId}/cancel",
		"/api/prompt-defaults",
		"/api/sessions",
		"/api/sessions/current",
		"/api/sessions/{sessionId}",
		"/api/sessions/{sessionId}/shares",
		"/api/sessions/share",
		"/api/sessions/shared/{shareId}",
		"/api/sessions/share/{shareId}",
	}

	for _, path := range expectedPaths {
		if paths[path] == nil {
			t.Errorf("Missing endpoint in OpenAPI spec: %s", path)
		}
	}

	if len(paths) != len(expectedPaths) {
		t.Errorf("Expected %d paths, but spec has %d paths. Check for undocumented endpoints.", len(expectedPaths), len(paths))
	}
}

func TestSpecHasRBACDocumentation(t *testing.T) {
	spec, err := GetSpec()
	if err != nil {
		t.Fatalf("GetSpec() failed: %v", err)
	}

	paths := spec["paths"].(map[string]interface{})

	toolCallPath, ok := paths["/api/mcp/call-tool"].(map[string]interface{})
	if !ok {
		t.Fatal("MCP call-tool endpoint not found")
	}

	post, ok := toolCallPath["post"].(map[string]interface{})
	if !ok {
		t.Fatal("MCP call-tool POST operation not found")
	}

	desc, ok := post["description"].(string)
	if !ok || len(desc) < 50 {
		t.Error("MCP call-tool endpoint missing or too short description - should document RBAC enforcement")
	}

	responses, ok := post["responses"].(map[string]interface{})
	if !ok {
		t.Fatal("MCP call-tool POST responses not found")
	}

	if responses["403"] == nil {
		t.Error("MCP call-tool endpoint missing 403 Forbidden response for RBAC violations")
	}
}

func TestSpecHasSSEDocumentation(t *testing.T) {
	spec, err := GetSpec()
	if err != nil {
		t.Fatalf("GetSpec() failed: %v", err)
	}

	paths := spec["paths"].(map[string]interface{})

	eventsPath, ok := paths["/api/agent/runs/{runId}/events"].(map[string]interface{})
	if !ok {
		t.Fatal("Agent run events endpoint not found")
	}

	get, ok := eventsPath["get"].(map[string]interface{})
	if !ok {
		t.Fatal("Agent run events GET operation not found")
	}

	responses, ok := get["responses"].(map[string]interface{})
	if !ok {
		t.Fatal("Agent run events responses not found")
	}

	response200, ok := responses["200"].(map[string]interface{})
	if !ok {
		t.Fatal("Agent run events 200 response not found")
	}

	content, ok := response200["content"].(map[string]interface{})
	if !ok {
		t.Fatal("Agent run events response content not found")
	}

	if content["text/event-stream"] == nil {
		t.Error("Agent run events endpoint missing text/event-stream content type for SSE")
	}
}

func TestSpecHasRateLimitingDocumentation(t *testing.T) {
	spec, err := GetSpec()
	if err != nil {
		t.Fatalf("GetSpec() failed: %v", err)
	}

	paths := spec["paths"].(map[string]interface{})

	sharePath, ok := paths["/api/sessions/share"].(map[string]interface{})
	if !ok {
		t.Fatal("Session share endpoint not found")
	}

	post, ok := sharePath["post"].(map[string]interface{})
	if !ok {
		t.Fatal("Session share POST operation not found")
	}

	responses, ok := post["responses"].(map[string]interface{})
	if !ok {
		t.Fatal("Session share POST responses not found")
	}

	if responses["429"] == nil {
		t.Error("Session share endpoint missing 429 Too Many Requests response for rate limiting")
	}
}

func TestSpecHasComponents(t *testing.T) {
	spec, err := GetSpec()
	if err != nil {
		t.Fatalf("GetSpec() failed: %v", err)
	}

	components, ok := spec["components"].(map[string]interface{})
	if !ok {
		t.Fatal("OpenAPI spec components field is not an object")
	}

	requiredComponents := []string{"schemas", "securitySchemes", "parameters", "responses"}
	for _, comp := range requiredComponents {
		if components[comp] == nil {
			t.Errorf("OpenAPI spec components missing: %s", comp)
		}
	}
}

func TestSpecHasKeySchemas(t *testing.T) {
	spec, err := GetSpec()
	if err != nil {
		t.Fatalf("GetSpec() failed: %v", err)
	}

	components := spec["components"].(map[string]interface{})
	schemas, ok := components["schemas"].(map[string]interface{})
	if !ok {
		t.Fatal("OpenAPI spec schemas not found")
	}

	requiredSchemas := []string{
		"RunRequest",
		"SSEEvent",
		"ChatSession",
		"SessionMessage",
		"Tool",
		"ToolAnnotations",
		"CallToolParams",
		"CallToolResult",
		"AgentRun",
	}

	for _, schemaName := range requiredSchemas {
		if schemas[schemaName] == nil {
			t.Errorf("OpenAPI spec missing schema: %s", schemaName)
		}
	}
}

func TestSpecHasSecuritySchemes(t *testing.T) {
	spec, err := GetSpec()
	if err != nil {
		t.Fatalf("GetSpec() failed: %v", err)
	}

	components := spec["components"].(map[string]interface{})
	securitySchemes, ok := components["securitySchemes"].(map[string]interface{})
	if !ok {
		t.Fatal("OpenAPI spec securitySchemes not found")
	}

	for _, name := range []string{"GrafanaSession", "BearerToken"} {
		if securitySchemes[name] == nil {
			t.Errorf("OpenAPI spec missing %s security scheme", name)
		}
	}
}

func TestSpecHasCommonResponses(t *testing.T) {
	spec, err := GetSpec()
	if err != nil {
		t.Fatalf("GetSpec() failed: %v", err)
	}

	components := spec["components"].(map[string]interface{})
	responses, ok := components["responses"].(map[string]interface{})
	if !ok {
		t.Fatal("OpenAPI spec responses not found")
	}

	requiredResponses := []string{
		"BadRequest",
		"Unauthorized",
		"Forbidden",
		"NotFound",
		"TooManyRequests",
		"InternalError",
	}

	for _, responseName := range requiredResponses {
		if responses[responseName] == nil {
			t.Errorf("OpenAPI spec missing response: %s", responseName)
		}
	}
}

func TestSpecHasTags(t *testing.T) {
	spec, err := GetSpec()
	if err != nil {
		t.Fatalf("GetSpec() failed: %v", err)
	}

	tags, ok := spec["tags"].([]interface{})
	if !ok {
		t.Fatal("OpenAPI spec tags field is not an array")
	}

	if len(tags) == 0 {
		t.Error("OpenAPI spec has no tags")
	}

	expectedTags := []string{"Health", "MCP", "Agent", "Sessions", "Shares"}
	foundTags := make(map[string]bool)

	for _, tag := range tags {
		tagObj, ok := tag.(map[string]interface{})
		if !ok {
			continue
		}
		if name, ok := tagObj["name"].(string); ok {
			foundTags[name] = true
		}
	}

	for _, expectedTag := range expectedTags {
		if !foundTags[expectedTag] {
			t.Errorf("OpenAPI spec missing tag: %s", expectedTag)
		}
	}
}

func TestSpecHasServers(t *testing.T) {
	spec, err := GetSpec()
	if err != nil {
		t.Fatalf("GetSpec() failed: %v", err)
	}

	servers, ok := spec["servers"].([]interface{})
	if !ok {
		t.Fatal("OpenAPI spec servers field is not an array")
	}

	if len(servers) == 0 {
		t.Error("OpenAPI spec has no servers")
	}

	firstServer, ok := servers[0].(map[string]interface{})
	if !ok {
		t.Fatal("First server is not an object")
	}

	url, ok := firstServer["url"].(string)
	if !ok || url == "" {
		t.Error("First server missing URL")
	}

	expectedURL := "/api/plugins/consensys-asko11y-app/resources"
	if url != expectedURL {
		t.Errorf("Expected server URL %s, got %s", expectedURL, url)
	}
}
