package rbac

import (
	"consensys-asko11y-app/pkg/mcp"
	"strings"
)

var readOnlyTools = map[string]bool{
	"mcp-grafana_fetch_pyroscope_profile":         true,
	"mcp-grafana_find_error_pattern_logs":         true,
	"mcp-grafana_find_slow_requests":              true,
	"mcp-grafana_generate_deeplink":               true,
	"mcp-grafana_get_alert_group":                 true,
	"mcp-grafana_get_alert_rule_by_uid":           true,
	"mcp-grafana_get_annotation_tags":             true,
	"mcp-grafana_get_annotations":                 true,
	"mcp-grafana_get_assertions":                  true,
	"mcp-grafana_get_current_oncall_users":        true,
	"mcp-grafana_get_dashboard_by_uid":            true,
	"mcp-grafana_get_dashboard_panel_queries":     true,
	"mcp-grafana_get_dashboard_property":          true,
	"mcp-grafana_get_dashboard_summary":           true,
	"mcp-grafana_get_datasource_by_name":          true,
	"mcp-grafana_get_datasource_by_uid":           true,
	"mcp-grafana_get_incident":                    true,
	"mcp-grafana_get_oncall_shift":                true,
	"mcp-grafana_get_sift_analysis":               true,
	"mcp-grafana_get_sift_investigation":          true,
	"mcp-grafana_list_alert_groups":               true,
	"mcp-grafana_list_alert_rules":                true,
	"mcp-grafana_list_contact_points":             true,
	"mcp-grafana_list_datasources":                true,
	"mcp-grafana_list_incidents":                  true,
	"mcp-grafana_list_loki_label_names":           true,
	"mcp-grafana_list_loki_label_values":          true,
	"mcp-grafana_list_oncall_schedules":           true,
	"mcp-grafana_list_oncall_teams":               true,
	"mcp-grafana_list_oncall_users":               true,
	"mcp-grafana_list_prometheus_label_names":     true,
	"mcp-grafana_list_prometheus_label_values":    true,
	"mcp-grafana_list_prometheus_metric_metadata": true,
	"mcp-grafana_list_prometheus_metric_names":    true,
	"mcp-grafana_list_pyroscope_label_names":      true,
	"mcp-grafana_list_pyroscope_label_values":     true,
	"mcp-grafana_list_pyroscope_profile_types":    true,
	"mcp-grafana_list_sift_investigations":        true,
	"mcp-grafana_list_teams":                      true,
	"mcp-grafana_list_users_by_org":               true,
	"mcp-grafana_query_loki_logs":                 true,
	"mcp-grafana_query_loki_stats":                true,
	"mcp-grafana_query_prometheus":                true,
	"mcp-grafana_search_dashboards":               true,
	"mcp-grafana_search_folders":                  true,
}

func IsReadOnlyTool(toolName string) bool {
	return readOnlyTools[toolName]
}

func CanAccessTool(role, toolName string) bool {
	if role == "Admin" || role == "Editor" {
		return true
	}
	if !strings.HasPrefix(toolName, "mcp-grafana_") {
		return true
	}
	return IsReadOnlyTool(toolName)
}

func FilterToolsByRole(tools []mcp.Tool, role string) []mcp.Tool {
	if role == "Admin" || role == "Editor" {
		return tools
	}
	filtered := make([]mcp.Tool, 0, len(tools))
	for _, t := range tools {
		if CanAccessTool(role, t.Name) {
			filtered = append(filtered, t)
		}
	}
	return filtered
}
