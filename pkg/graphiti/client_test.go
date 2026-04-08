package graphiti

import (
	"strings"
	"testing"
)

func TestFormatSearchResponse_Empty(t *testing.T) {
	r := SearchResponse{}
	got := formatSearchResponse(r)
	if got != "" {
		t.Errorf("expected empty string for empty response, got %q", got)
	}
}

func TestFormatSearchResponse_WithEdgesAndNodes(t *testing.T) {
	r := SearchResponse{
		Edges: []EntityEdge{
			{Fact: "API Gateway depends on Auth Service"},
			{Name: "edge_name", Fact: ""},
		},
		Nodes: []EntityNode{
			{Name: "API Gateway", Summary: "Main entry point for API requests"},
			{Name: "No Summary", Summary: ""},
		},
	}
	got := formatSearchResponse(r)
	if got == "" {
		t.Fatal("expected non-empty response")
	}
	// Check for key content
	expected := []string{
		"Service Map Context",
		"API Gateway depends on Auth Service",
		"edge_name",
		"API Gateway: Main entry point for API requests",
	}
	for _, s := range expected {
		if !strings.Contains(got, s) {
			t.Errorf("expected response to contain %q, got:\n%s", s, got)
		}
	}
}

func TestFormatMemoryResponse_Empty(t *testing.T) {
	r := GetMemoryResponse{}
	got := formatMemoryResponse(r)
	if got != "" {
		t.Errorf("expected empty string for empty response, got %q", got)
	}
}

func TestFormatMemoryResponse_WithFactsAndNodes(t *testing.T) {
	r := GetMemoryResponse{
		Facts: []EntityEdge{
			{Fact: "Database connection pool exhausted"},
		},
		Nodes: []EntityNode{
			{Name: "PostgreSQL", Summary: "Primary database for auth service"},
		},
	}
	got := formatMemoryResponse(r)
	if got == "" {
		t.Fatal("expected non-empty response")
	}
	expected := []string{
		"Database connection pool exhausted",
		"PostgreSQL: Primary database for auth service",
	}
	for _, s := range expected {
		if !strings.Contains(got, s) {
			t.Errorf("expected response to contain %q", s)
		}
	}
}

func TestObservabilityEntityTypes(t *testing.T) {
	types := ObservabilityEntityTypes()
	expectedKeys := []string{
		"Service", "Database", "Queue", "Infrastructure",
		"Namespace", "Dashboard", "Alert", "Datasource", "Team",
	}
	for _, key := range expectedKeys {
		if _, ok := types[key]; !ok {
			t.Errorf("missing entity type %q", key)
		}
	}
}
