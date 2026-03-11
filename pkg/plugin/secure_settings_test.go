package plugin

import (
	"consensys-asko11y-app/pkg/mcp"
	"testing"
)

func TestApplySecureHeaders_InjectsMatchingServer(t *testing.T) {
	servers := []mcp.ServerConfig{
		{ID: "srv1", Name: "Server 1", Headers: nil},
		{ID: "srv2", Name: "Server 2", Headers: nil},
	}
	secure := map[string]string{
		"mcpServerHeader.srv1.Authorization": "Bearer token123",
		"mcpServerHeader.srv2.X-API-Key":     "key456",
	}

	applySecureHeaders(servers, secure)

	if servers[0].Headers["Authorization"] != "Bearer token123" {
		t.Errorf("Expected Authorization header on srv1, got %q", servers[0].Headers["Authorization"])
	}
	if servers[1].Headers["X-API-Key"] != "key456" {
		t.Errorf("Expected X-API-Key header on srv2, got %q", servers[1].Headers["X-API-Key"])
	}
}

func TestApplySecureHeaders_IgnoresUnknownServer(t *testing.T) {
	servers := []mcp.ServerConfig{
		{ID: "srv1", Name: "Server 1"},
	}
	secure := map[string]string{
		"mcpServerHeader.unknown.Authorization": "Bearer token",
	}

	applySecureHeaders(servers, secure)

	if servers[0].Headers != nil {
		t.Errorf("Expected no headers on srv1, got %v", servers[0].Headers)
	}
}

func TestApplySecureHeaders_IgnoresMalformedKeys(t *testing.T) {
	servers := []mcp.ServerConfig{
		{ID: "srv1", Name: "Server 1"},
	}
	secure := map[string]string{
		"mcpServerHeader.nodot":    "value",
		"mcpServerHeader..empty":   "value",
		"mcpServerHeader.srv1.":    "value",
		"redisURL":                 "redis://localhost:6379/0",
		"someOtherKey":             "value",
	}

	applySecureHeaders(servers, secure)

	if servers[0].Headers != nil {
		t.Errorf("Expected no headers on srv1, got %v", servers[0].Headers)
	}
}

func TestApplySecureHeaders_EmptySecureMap(t *testing.T) {
	servers := []mcp.ServerConfig{
		{ID: "srv1", Name: "Server 1"},
	}

	applySecureHeaders(servers, nil)
	applySecureHeaders(servers, map[string]string{})

	if servers[0].Headers != nil {
		t.Errorf("Expected no headers on srv1, got %v", servers[0].Headers)
	}
}

func TestApplySecureHeaders_MultipleHeadersSameServer(t *testing.T) {
	servers := []mcp.ServerConfig{
		{ID: "srv1", Name: "Server 1"},
	}
	secure := map[string]string{
		"mcpServerHeader.srv1.Authorization": "Bearer token",
		"mcpServerHeader.srv1.X-Custom":      "custom-value",
	}

	applySecureHeaders(servers, secure)

	if len(servers[0].Headers) != 2 {
		t.Errorf("Expected 2 headers, got %d", len(servers[0].Headers))
	}
	if servers[0].Headers["Authorization"] != "Bearer token" {
		t.Errorf("Expected Authorization header, got %q", servers[0].Headers["Authorization"])
	}
	if servers[0].Headers["X-Custom"] != "custom-value" {
		t.Errorf("Expected X-Custom header, got %q", servers[0].Headers["X-Custom"])
	}
}

func TestApplySecureHeaders_DottedHeaderName(t *testing.T) {
	servers := []mcp.ServerConfig{
		{ID: "srv1", Name: "Server 1"},
	}
	secure := map[string]string{
		"mcpServerHeader.srv1.X-Custom.Dotted.Header": "dotted-value",
	}

	applySecureHeaders(servers, secure)

	if servers[0].Headers["X-Custom.Dotted.Header"] != "dotted-value" {
		t.Errorf("Expected X-Custom.Dotted.Header, got %v", servers[0].Headers)
	}
}
