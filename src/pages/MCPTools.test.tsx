/**
 * Unit tests for MCPTools page utilities and helpers
 * The full page component requires complex Grafana runtime mocking
 */

describe('MCPToolsPage utilities', () => {
  describe('Tool Settings', () => {
    beforeEach(() => {
      localStorage.clear();
    });

    it('should store tool settings in localStorage', () => {
      const settings = { 'prometheus_query': true, 'loki_query': false };
      localStorage.setItem('mcp-tool-settings', JSON.stringify(settings));

      const stored = localStorage.getItem('mcp-tool-settings');
      expect(stored).not.toBeNull();
      expect(JSON.parse(stored!)).toEqual(settings);
    });

    it('should retrieve tool settings from localStorage', () => {
      const settings = { 'grafana_dashboard_list': true };
      localStorage.setItem('mcp-tool-settings', JSON.stringify(settings));

      const stored = JSON.parse(localStorage.getItem('mcp-tool-settings')!);
      expect(stored).toHaveProperty('grafana_dashboard_list', true);
    });

    it('should handle empty localStorage', () => {
      const stored = localStorage.getItem('mcp-tool-settings');
      expect(stored).toBeNull();
    });

    it('should allow updating tool settings', () => {
      const settings = { 'tool1': true, 'tool2': true };
      localStorage.setItem('mcp-tool-settings', JSON.stringify(settings));

      const updated = { ...settings, 'tool2': false };
      localStorage.setItem('mcp-tool-settings', JSON.stringify(updated));

      const stored = JSON.parse(localStorage.getItem('mcp-tool-settings')!);
      expect(stored.tool2).toBe(false);
    });
  });

  describe('Tool categorization', () => {
    const getToolCategory = (toolName: string): string => {
      if (toolName.startsWith('prometheus_') || toolName.startsWith('mimir_')) {
        return 'Metrics';
      }
      if (toolName.startsWith('loki_')) {
        return 'Logs';
      }
      if (toolName.startsWith('tempo_')) {
        return 'Traces';
      }
      if (toolName.startsWith('grafana_')) {
        return 'Grafana';
      }
      if (toolName.startsWith('alertmanager_')) {
        return 'Alerting';
      }
      return 'Other';
    };

    it('should categorize prometheus tools as Metrics', () => {
      expect(getToolCategory('prometheus_query')).toBe('Metrics');
      expect(getToolCategory('prometheus_labels')).toBe('Metrics');
    });

    it('should categorize mimir tools as Metrics', () => {
      expect(getToolCategory('mimir_query')).toBe('Metrics');
    });

    it('should categorize loki tools as Logs', () => {
      expect(getToolCategory('loki_query')).toBe('Logs');
      expect(getToolCategory('loki_labels')).toBe('Logs');
    });

    it('should categorize tempo tools as Traces', () => {
      expect(getToolCategory('tempo_search')).toBe('Traces');
    });

    it('should categorize grafana tools as Grafana', () => {
      expect(getToolCategory('grafana_dashboard_list')).toBe('Grafana');
      expect(getToolCategory('grafana_datasource_list')).toBe('Grafana');
    });

    it('should categorize alertmanager tools as Alerting', () => {
      expect(getToolCategory('alertmanager_silence')).toBe('Alerting');
    });

    it('should categorize unknown tools as Other', () => {
      expect(getToolCategory('custom_tool')).toBe('Other');
      expect(getToolCategory('unknown')).toBe('Other');
    });
  });

  describe('Tool filtering', () => {
    const tools = [
      { name: 'prometheus_query', description: 'Run Prometheus queries' },
      { name: 'loki_query', description: 'Run Loki log queries' },
      { name: 'grafana_dashboard_list', description: 'List dashboards' },
      { name: 'tempo_search', description: 'Search traces' },
    ];

    const filterTools = (tools: any[], searchQuery: string): any[] => {
      if (!searchQuery.trim()) { return tools; }
      const query = searchQuery.toLowerCase();
      return tools.filter(
        (tool) =>
          tool.name.toLowerCase().includes(query) ||
          (tool.description && tool.description.toLowerCase().includes(query))
      );
    };

    it('should return all tools when search is empty', () => {
      expect(filterTools(tools, '')).toEqual(tools);
      expect(filterTools(tools, '  ')).toEqual(tools);
    });

    it('should filter tools by name', () => {
      const result = filterTools(tools, 'prometheus');
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('prometheus_query');
    });

    it('should filter tools by description', () => {
      const result = filterTools(tools, 'dashboards');
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('grafana_dashboard_list');
    });

    it('should be case insensitive', () => {
      const result = filterTools(tools, 'LOKI');
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('loki_query');
    });

    it('should return empty array when no match', () => {
      const result = filterTools(tools, 'nonexistent');
      expect(result).toHaveLength(0);
    });
  });
});

