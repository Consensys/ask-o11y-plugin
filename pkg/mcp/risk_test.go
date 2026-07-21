package mcp

import "testing"

func ptrBool(v bool) *bool { return &v }

func TestClassifyToolRisk_ReadOnlyAnnotation(t *testing.T) {
	risk := ClassifyToolRisk(Tool{
		Name:        "grafana_query_prometheus",
		Annotations: &ToolAnnotations{ReadOnlyHint: ptrBool(true)},
	}, []ServerConfig{{ID: "grafana", Trusted: true}})

	if risk.RequiresApproval {
		t.Fatalf("read-only tool should not require approval: %+v", risk)
	}
	if !risk.ReadOnly {
		t.Fatalf("expected read-only risk: %+v", risk)
	}
}

func TestClassifyToolRisk_DestructiveNameRequiresApproval(t *testing.T) {
	risk := ClassifyToolRisk(Tool{Name: "grafana_delete_dashboard"}, []ServerConfig{{ID: "grafana", Trusted: true}})

	if !risk.RequiresApproval {
		t.Fatalf("delete tool should require approval: %+v", risk)
	}
	if !risk.Destructive {
		t.Fatalf("delete tool should be destructive: %+v", risk)
	}
}

func TestClassifyToolRisk_OverrideCanForceApproval(t *testing.T) {
	risk := ClassifyToolRisk(Tool{
		Name:        "grafana_query_prometheus",
		Annotations: &ToolAnnotations{ReadOnlyHint: ptrBool(true)},
	}, []ServerConfig{{
		ID:      "grafana",
		Trusted: true,
		RiskOverrides: map[string]ToolRiskOverride{
			"grafana_query_prometheus": {RequiresApproval: ptrBool(true), Reason: "sensitive tenant query"},
		},
	}})

	if !risk.RequiresApproval {
		t.Fatalf("override should force approval: %+v", risk)
	}
	if risk.Reason != "sensitive tenant query" {
		t.Fatalf("override reason not preserved: %q", risk.Reason)
	}
}
