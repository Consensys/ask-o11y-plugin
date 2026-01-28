/**
 * RBAC utilities for filtering MCP tools by user role.
 *
 * CRITICAL: This logic MUST match the backend implementation in pkg/plugin/plugin.go:299-393
 *
 * Role hierarchy:
 * - Admin/Editor: Full access to all tools (56 tools)
 * - Viewer: Read-only access (45 tools: get*, list*, query*, search*, find*, generate*)
 */

export type UserRole = 'Admin' | 'Editor' | 'Viewer';

/**
 * Checks if a tool is read-only (safe for Viewers).
 *
 * This list MUST match the backend implementation in pkg/plugin/plugin.go:302-348
 *
 * For tools with mcp-grafana_ prefix: checks against explicit whitelist
 * For tools without prefix: checks if they match Grafana read-only patterns
 *
 * @param toolName - The name of the tool to check
 * @returns true if the tool is read-only, false otherwise or unknown
 */
export function isReadOnlyTool(toolName: string): boolean {
  // For mcp-grafana_ prefixed tools, check explicit whitelist
  if (toolName.startsWith('mcp-grafana_')) {
    const readOnlyTools = new Set([
      'mcp-grafana_fetch_pyroscope_profile',
      'mcp-grafana_find_error_pattern_logs',
      'mcp-grafana_find_slow_requests',
      'mcp-grafana_generate_deeplink',
      'mcp-grafana_get_alert_group',
      'mcp-grafana_get_alert_rule_by_uid',
      'mcp-grafana_get_annotation_tags',
      'mcp-grafana_get_annotations',
      'mcp-grafana_get_assertions',
      'mcp-grafana_get_current_oncall_users',
      'mcp-grafana_get_dashboard_by_uid',
      'mcp-grafana_get_dashboard_panel_queries',
      'mcp-grafana_get_dashboard_property',
      'mcp-grafana_get_dashboard_summary',
      'mcp-grafana_get_datasource_by_name',
      'mcp-grafana_get_datasource_by_uid',
      'mcp-grafana_get_incident',
      'mcp-grafana_get_oncall_shift',
      'mcp-grafana_get_sift_analysis',
      'mcp-grafana_get_sift_investigation',
      'mcp-grafana_list_alert_groups',
      'mcp-grafana_list_alert_rules',
      'mcp-grafana_list_contact_points',
      'mcp-grafana_list_datasources',
      'mcp-grafana_list_incidents',
      'mcp-grafana_list_loki_label_names',
      'mcp-grafana_list_loki_label_values',
      'mcp-grafana_list_oncall_schedules',
      'mcp-grafana_list_oncall_teams',
      'mcp-grafana_list_oncall_users',
      'mcp-grafana_list_prometheus_label_names',
      'mcp-grafana_list_prometheus_label_values',
      'mcp-grafana_list_prometheus_metric_metadata',
      'mcp-grafana_list_prometheus_metric_names',
      'mcp-grafana_list_pyroscope_label_names',
      'mcp-grafana_list_pyroscope_label_values',
      'mcp-grafana_list_pyroscope_profile_types',
      'mcp-grafana_list_sift_investigations',
      'mcp-grafana_list_teams',
      'mcp-grafana_list_users_by_org',
      'mcp-grafana_query_loki_logs',
      'mcp-grafana_query_loki_stats',
      'mcp-grafana_query_prometheus',
      'mcp-grafana_search_dashboards',
      'mcp-grafana_search_folders',
    ]);
    return readOnlyTools.has(toolName);
  }

  // For tools without prefix, check if they match Grafana read-only patterns
  // Built-in Grafana tools follow specific naming patterns
  const grafanaReadOnlyPatterns = /^(get_|list_|query_|search_|find_|generate_|fetch_)/;
  return grafanaReadOnlyPatterns.test(toolName);
}

/**
 * Checks if a user with the given role can access a tool.
 *
 * Matches backend logic in pkg/plugin/plugin.go:353-375
 *
 * @param role - User role (Admin, Editor, Viewer, or unknown)
 * @param toolName - Name of the tool to check
 * @returns true if the user can access the tool, false otherwise
 */
export function canAccessTool(role: UserRole | string, toolName: string): boolean {
  // Admin and Editor can access all tools
  if (role === 'Admin' || role === 'Editor') {
    return true;
  }

  // Viewer and unknown roles: check if tool is accessible
  // For Grafana tools (with mcp-grafana_ prefix), check whitelist
  if (toolName.startsWith('mcp-grafana_')) {
    return isReadOnlyTool(toolName);
  }

  // For tools without prefix, distinguish between Grafana built-in and external tools
  const grafanaReadOnlyPatterns = /^(get_|list_|query_|search_|find_|generate_|fetch_)/;
  const grafanaWritePatterns = /^(create_|update_|delete_|set_|add_|remove_|execute_)/;

  // If tool matches Grafana read pattern, allow (read-only Grafana tool)
  if (grafanaReadOnlyPatterns.test(toolName)) {
    return true;
  }

  // If tool matches Grafana write pattern, deny (write Grafana tool)
  if (grafanaWritePatterns.test(toolName)) {
    return false;
  }

  // Tool doesn't match any Grafana pattern - assume it's an external tool
  // External tools are accessible to all roles (trust external MCP servers)
  return true;
}

/**
 * Filters tool list based on user role.
 *
 * Matches backend logic in pkg/plugin/plugin.go:377-393
 *
 * @param tools - Array of tools to filter
 * @param role - User role
 * @returns Filtered array of tools accessible to the role
 */
export function filterToolsByRole<T extends { name: string }>(tools: T[], role: UserRole | string): T[] {
  // Admin and Editor get all tools
  if (role === 'Admin' || role === 'Editor') {
    return tools;
  }

  // Viewer gets filtered tools
  return tools.filter((tool) => canAccessTool(role, tool.name));
}
