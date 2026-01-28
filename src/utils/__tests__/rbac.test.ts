import { isReadOnlyTool, canAccessTool, filterToolsByRole } from '../rbac';

describe('RBAC Utilities', () => {
  describe('isReadOnlyTool', () => {
    it('should identify read-only get* tools', () => {
      expect(isReadOnlyTool('mcp-grafana_get_dashboard_by_uid')).toBe(true);
      expect(isReadOnlyTool('mcp-grafana_get_datasource_by_name')).toBe(true);
      expect(isReadOnlyTool('mcp-grafana_get_alert_rule_by_uid')).toBe(true);
    });

    it('should identify read-only list* tools', () => {
      expect(isReadOnlyTool('mcp-grafana_list_datasources')).toBe(true);
      expect(isReadOnlyTool('mcp-grafana_list_alert_rules')).toBe(true);
      expect(isReadOnlyTool('mcp-grafana_list_teams')).toBe(true);
    });

    it('should identify read-only query* tools', () => {
      expect(isReadOnlyTool('mcp-grafana_query_prometheus')).toBe(true);
      expect(isReadOnlyTool('mcp-grafana_query_loki_logs')).toBe(true);
      expect(isReadOnlyTool('mcp-grafana_query_loki_stats')).toBe(true);
    });

    it('should identify read-only search* tools', () => {
      expect(isReadOnlyTool('mcp-grafana_search_dashboards')).toBe(true);
      expect(isReadOnlyTool('mcp-grafana_search_folders')).toBe(true);
    });

    it('should identify read-only find* tools', () => {
      expect(isReadOnlyTool('mcp-grafana_find_error_pattern_logs')).toBe(true);
      expect(isReadOnlyTool('mcp-grafana_find_slow_requests')).toBe(true);
    });

    it('should identify read-only generate* tools', () => {
      expect(isReadOnlyTool('mcp-grafana_generate_deeplink')).toBe(true);
    });

    it('should identify read-only fetch* tools', () => {
      expect(isReadOnlyTool('mcp-grafana_fetch_pyroscope_profile')).toBe(true);
    });

    it('should identify write tools as not read-only', () => {
      expect(isReadOnlyTool('mcp-grafana_create_dashboard')).toBe(false);
      expect(isReadOnlyTool('mcp-grafana_update_dashboard')).toBe(false);
      expect(isReadOnlyTool('mcp-grafana_delete_dashboard')).toBe(false);
    });

    it('should handle non-Grafana tools', () => {
      expect(isReadOnlyTool('custom_tool')).toBe(false);
      expect(isReadOnlyTool('mcp-custom_write_tool')).toBe(false);
    });
  });

  describe('canAccessTool', () => {
    describe('Admin role', () => {
      it('should allow access to all Grafana tools', () => {
        expect(canAccessTool('Admin', 'mcp-grafana_get_dashboard_by_uid')).toBe(true);
        expect(canAccessTool('Admin', 'mcp-grafana_create_dashboard')).toBe(true);
        expect(canAccessTool('Admin', 'mcp-grafana_update_dashboard')).toBe(true);
        expect(canAccessTool('Admin', 'mcp-grafana_delete_dashboard')).toBe(true);
      });

      it('should allow access to all non-Grafana tools', () => {
        expect(canAccessTool('Admin', 'custom_tool')).toBe(true);
        expect(canAccessTool('Admin', 'custom_write_tool')).toBe(true);
      });
    });

    describe('Editor role', () => {
      it('should allow access to all Grafana tools', () => {
        expect(canAccessTool('Editor', 'mcp-grafana_get_dashboard_by_uid')).toBe(true);
        expect(canAccessTool('Editor', 'mcp-grafana_create_dashboard')).toBe(true);
        expect(canAccessTool('Editor', 'mcp-grafana_update_dashboard')).toBe(true);
        expect(canAccessTool('Editor', 'mcp-grafana_delete_dashboard')).toBe(true);
      });

      it('should allow access to all non-Grafana tools', () => {
        expect(canAccessTool('Editor', 'custom_tool')).toBe(true);
        expect(canAccessTool('Editor', 'custom_write_tool')).toBe(true);
      });
    });

    describe('Viewer role', () => {
      it('should allow access to read-only Grafana tools', () => {
        expect(canAccessTool('Viewer', 'mcp-grafana_get_dashboard_by_uid')).toBe(true);
        expect(canAccessTool('Viewer', 'mcp-grafana_list_datasources')).toBe(true);
        expect(canAccessTool('Viewer', 'mcp-grafana_query_prometheus')).toBe(true);
        expect(canAccessTool('Viewer', 'mcp-grafana_search_dashboards')).toBe(true);
      });

      it('should deny access to write Grafana tools', () => {
        expect(canAccessTool('Viewer', 'mcp-grafana_create_dashboard')).toBe(false);
        expect(canAccessTool('Viewer', 'mcp-grafana_update_dashboard')).toBe(false);
        expect(canAccessTool('Viewer', 'mcp-grafana_delete_dashboard')).toBe(false);
      });

      it('should allow access to all non-Grafana tools', () => {
        expect(canAccessTool('Viewer', 'custom_tool')).toBe(true);
        expect(canAccessTool('Viewer', 'custom_get_tool')).toBe(true);
      });
    });

    describe('Unknown role', () => {
      it('should default to Viewer permissions for Grafana tools', () => {
        expect(canAccessTool('Unknown', 'mcp-grafana_get_dashboard_by_uid')).toBe(true);
        expect(canAccessTool('Unknown', 'mcp-grafana_create_dashboard')).toBe(false);
      });

      it('should allow access to non-Grafana tools', () => {
        expect(canAccessTool('Unknown', 'custom_tool')).toBe(true);
      });
    });
  });

  describe('filterToolsByRole', () => {
    const mockTools = [
      { name: 'mcp-grafana_get_dashboard_by_uid', description: 'Get dashboard' },
      { name: 'mcp-grafana_create_dashboard', description: 'Create dashboard' },
      { name: 'mcp-grafana_list_datasources', description: 'List datasources' },
      { name: 'mcp-grafana_update_datasource', description: 'Update datasource' },
      { name: 'custom_tool', description: 'Custom tool' },
    ];

    it('should return all tools for Admin', () => {
      const filtered = filterToolsByRole(mockTools, 'Admin');
      expect(filtered).toHaveLength(5);
      expect(filtered).toEqual(mockTools);
    });

    it('should return all tools for Editor', () => {
      const filtered = filterToolsByRole(mockTools, 'Editor');
      expect(filtered).toHaveLength(5);
      expect(filtered).toEqual(mockTools);
    });

    it('should filter tools for Viewer', () => {
      const filtered = filterToolsByRole(mockTools, 'Viewer');
      expect(filtered).toHaveLength(3);
      expect(filtered.map((t) => t.name)).toEqual([
        'mcp-grafana_get_dashboard_by_uid',
        'mcp-grafana_list_datasources',
        'custom_tool',
      ]);
    });

    it('should handle empty tool list', () => {
      expect(filterToolsByRole([], 'Viewer')).toEqual([]);
      expect(filterToolsByRole([], 'Admin')).toEqual([]);
    });

    it('should handle tools with additional properties', () => {
      const toolsWithMetadata = [
        { name: 'mcp-grafana_get_dashboard_by_uid', description: 'Get dashboard', version: '1.0' },
        { name: 'mcp-grafana_create_dashboard', description: 'Create dashboard', version: '1.0' },
      ];

      const filtered = filterToolsByRole(toolsWithMetadata, 'Viewer');
      expect(filtered).toHaveLength(1);
      expect(filtered[0]).toEqual({
        name: 'mcp-grafana_get_dashboard_by_uid',
        description: 'Get dashboard',
        version: '1.0',
      });
    });

    it('should default unknown roles to Viewer permissions', () => {
      const filtered = filterToolsByRole(mockTools, 'UnknownRole');
      expect(filtered).toHaveLength(3); // Same as Viewer
    });
  });
});
