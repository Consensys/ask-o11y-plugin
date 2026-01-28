import { AggregatedMCPClient } from '../aggregatedMCPClient';
import type { BackendMCPClient } from '../backendMCPClient';
import type { BuiltInMCPClient } from '../builtInMCPClient';
import type { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types';

// Mock clients
const createMockBuiltInClient = (
  tools: Tool[] = [],
  shouldFail = false
): jest.Mocked<BuiltInMCPClient> => {
  return {
    listTools: jest.fn().mockImplementation(async () => {
      if (shouldFail) {
        throw new Error('Built-in MCP failed');
      }
      return tools;
    }),
    callTool: jest.fn().mockImplementation(async (params) => ({
      content: [{ type: 'text', text: `Built-in result for ${params.name}` }],
      isError: false,
    })),
    isTool: jest.fn((toolName: string) => tools.some((t) => t.name === toolName)),
    clearCache: jest.fn(),
    disconnect: jest.fn(),
    getHealth: jest.fn(async () => ({
      status: shouldFail ? 'unhealthy' : 'healthy',
      mcpServers: 1,
      message: shouldFail ? 'Connection failed' : 'Built-in MCP is healthy',
    })),
    isAvailable: jest.fn(async () => !shouldFail),
  } as any;
};

const createMockBackendClient = (
  tools: Tool[] = [],
  shouldFail = false
): jest.Mocked<BackendMCPClient> => {
  return {
    listTools: jest.fn().mockImplementation(async () => {
      if (shouldFail) {
        throw new Error('Backend MCP failed');
      }
      return tools;
    }),
    callTool: jest.fn().mockImplementation(async (params) => ({
      content: [{ type: 'text', text: `Backend result for ${params.name}` }],
      isError: false,
    })),
    isTool: jest.fn((toolName: string) => tools.some((t) => t.name === toolName)),
    clearCache: jest.fn(),
    getHealth: jest.fn(async () => ({
      status: shouldFail ? 'error' : 'ok',
      mcpServers: shouldFail ? 0 : 2,
      message: shouldFail ? 'Failed to connect' : 'All servers healthy',
    })),
  } as any;
};

describe('AggregatedMCPClient', () => {
  let builtInClient: jest.Mocked<BuiltInMCPClient>;
  let backendClient: jest.Mocked<BackendMCPClient>;
  let aggregatedClient: AggregatedMCPClient;

  const builtInTools: Tool[] = [
    { name: 'query_prometheus', description: 'Query Prometheus', inputSchema: { type: 'object' } },
    { name: 'get_dashboard', description: 'Get dashboard', inputSchema: { type: 'object' } },
  ];

  const backendTools: Tool[] = [
    {
      name: 'mcp-grafana_query_loki',
      description: 'Query Loki',
      inputSchema: { type: 'object' },
    },
    {
      name: 'custom-server_fetch_data',
      description: 'Fetch data',
      inputSchema: { type: 'object' },
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('listTools', () => {
    it('should merge tools from both sources', async () => {
      builtInClient = createMockBuiltInClient(builtInTools);
      backendClient = createMockBackendClient(backendTools);
      aggregatedClient = new AggregatedMCPClient({
        builtInClient,
        backendClient,
        useBuiltIn: true,
        useBackend: true,
      });

      const tools = await aggregatedClient.listTools();

      expect(tools).toHaveLength(4);
      expect(tools.map((t) => t.name)).toEqual([
        'query_prometheus',
        'get_dashboard',
        'mcp-grafana_query_loki',
        'custom-server_fetch_data',
      ]);
      expect(builtInClient.listTools).toHaveBeenCalledTimes(1);
      expect(backendClient.listTools).toHaveBeenCalledTimes(1);
    });

    it('should keep built-in tool names as-is (no prefixing)', async () => {
      builtInClient = createMockBuiltInClient(builtInTools);
      backendClient = createMockBackendClient([]);
      aggregatedClient = new AggregatedMCPClient({
        builtInClient,
        backendClient,
        useBuiltIn: true,
        useBackend: true,
      });

      const tools = await aggregatedClient.listTools();

      expect(tools[0].name).toBe('query_prometheus'); // No prefix
      expect(tools[1].name).toBe('get_dashboard'); // No prefix
    });

    it('should keep backend tool prefixes unchanged', async () => {
      builtInClient = createMockBuiltInClient([]);
      backendClient = createMockBackendClient(backendTools);
      aggregatedClient = new AggregatedMCPClient({
        builtInClient,
        backendClient,
        useBuiltIn: true,
        useBackend: true,
      });

      const tools = await aggregatedClient.listTools();

      expect(tools[0].name).toBe('mcp-grafana_query_loki'); // Prefix preserved
      expect(tools[1].name).toBe('custom-server_fetch_data'); // Prefix preserved
    });

    it('should build correct tool registry for routing', async () => {
      builtInClient = createMockBuiltInClient(builtInTools);
      backendClient = createMockBackendClient(backendTools);
      aggregatedClient = new AggregatedMCPClient({
        builtInClient,
        backendClient,
        useBuiltIn: true,
        useBackend: true,
      });

      await aggregatedClient.listTools();

      // Check registry was built correctly
      expect(aggregatedClient.isTool('query_prometheus')).toBe(true);
      expect(aggregatedClient.isTool('get_dashboard')).toBe(true);
      expect(aggregatedClient.isTool('mcp-grafana_query_loki')).toBe(true);
      expect(aggregatedClient.isTool('custom-server_fetch_data')).toBe(true);
      expect(aggregatedClient.isTool('nonexistent_tool')).toBe(false);
    });

    it('should handle tool name conflicts (prioritize built-in)', async () => {
      const conflictingTools = [
        {
          name: 'query_prometheus',
          description: 'Backend Prometheus',
          inputSchema: { type: 'object' },
        },
      ];

      builtInClient = createMockBuiltInClient(builtInTools);
      backendClient = createMockBackendClient(conflictingTools);
      aggregatedClient = new AggregatedMCPClient({
        builtInClient,
        backendClient,
        useBuiltIn: true,
        useBackend: true,
      });

      // Should log warning but still work
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
      const tools = await aggregatedClient.listTools();

      // Built-in tool should be in the list, backend version filtered out
      expect(tools.filter((t) => t.name === 'query_prometheus')).toHaveLength(1);
      expect(tools.find((t) => t.name === 'query_prometheus')?.description).toBe('Query Prometheus');

      // Warning should have been logged
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Tool name conflict: 'query_prometheus'")
      );

      consoleWarnSpy.mockRestore();
    });

    it('should handle built-in failure gracefully (fallback to external)', async () => {
      builtInClient = createMockBuiltInClient([], true); // Fails
      backendClient = createMockBackendClient(backendTools);
      aggregatedClient = new AggregatedMCPClient({
        builtInClient,
        backendClient,
        useBuiltIn: true,
        useBackend: true,
      });

      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
      const tools = await aggregatedClient.listTools();

      // Should return backend tools only
      expect(tools).toHaveLength(2);
      expect(tools.map((t) => t.name)).toEqual(['mcp-grafana_query_loki', 'custom-server_fetch_data']);

      // Error should have been logged
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Built-in MCP failed'),
        expect.anything()
      );

      consoleErrorSpy.mockRestore();
    });

    it('should handle backend failure gracefully (fallback to built-in)', async () => {
      builtInClient = createMockBuiltInClient(builtInTools);
      backendClient = createMockBackendClient([], true); // Fails
      aggregatedClient = new AggregatedMCPClient({
        builtInClient,
        backendClient,
        useBuiltIn: true,
        useBackend: true,
      });

      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
      const tools = await aggregatedClient.listTools();

      // Should return built-in tools only
      expect(tools).toHaveLength(2);
      expect(tools.map((t) => t.name)).toEqual(['query_prometheus', 'get_dashboard']);

      // Error should have been logged
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Backend MCP failed'),
        expect.anything()
      );

      consoleErrorSpy.mockRestore();
    });

    it('should return empty array when both sources fail', async () => {
      builtInClient = createMockBuiltInClient([], true); // Fails
      backendClient = createMockBackendClient([], true); // Fails
      aggregatedClient = new AggregatedMCPClient({
        builtInClient,
        backendClient,
        useBuiltIn: true,
        useBackend: true,
      });

      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
      const tools = await aggregatedClient.listTools();

      expect(tools).toEqual([]);
      expect(consoleErrorSpy).toHaveBeenCalledTimes(3); // 2 failures + "No tools available"

      consoleErrorSpy.mockRestore();
    });

    it('should cache tools after first call', async () => {
      builtInClient = createMockBuiltInClient(builtInTools);
      backendClient = createMockBackendClient(backendTools);
      aggregatedClient = new AggregatedMCPClient({
        builtInClient,
        backendClient,
        useBuiltIn: true,
        useBackend: true,
      });

      const tools1 = await aggregatedClient.listTools();
      const tools2 = await aggregatedClient.listTools();

      expect(tools1).toEqual(tools2);
      expect(builtInClient.listTools).toHaveBeenCalledTimes(1);
      expect(backendClient.listTools).toHaveBeenCalledTimes(1);
    });

    it('should only fetch from built-in when backend is disabled', async () => {
      builtInClient = createMockBuiltInClient(builtInTools);
      backendClient = createMockBackendClient(backendTools);
      aggregatedClient = new AggregatedMCPClient({
        builtInClient,
        backendClient,
        useBuiltIn: true,
        useBackend: false, // Backend disabled
      });

      const tools = await aggregatedClient.listTools();

      expect(tools).toHaveLength(2);
      expect(builtInClient.listTools).toHaveBeenCalledTimes(1);
      expect(backendClient.listTools).not.toHaveBeenCalled();
    });

    it('should only fetch from backend when built-in is disabled', async () => {
      builtInClient = createMockBuiltInClient(builtInTools);
      backendClient = createMockBackendClient(backendTools);
      aggregatedClient = new AggregatedMCPClient({
        builtInClient,
        backendClient,
        useBuiltIn: false, // Built-in disabled
        useBackend: true,
      });

      const tools = await aggregatedClient.listTools();

      expect(tools).toHaveLength(2);
      expect(builtInClient.listTools).not.toHaveBeenCalled();
      expect(backendClient.listTools).toHaveBeenCalledTimes(1);
    });
  });

  describe('callTool', () => {
    beforeEach(async () => {
      builtInClient = createMockBuiltInClient(builtInTools);
      backendClient = createMockBackendClient(backendTools);
      aggregatedClient = new AggregatedMCPClient({
        builtInClient,
        backendClient,
        useBuiltIn: true,
        useBackend: true,
      });

      // Build registry
      await aggregatedClient.listTools();
    });

    it('should route built-in tools to builtInClient', async () => {
      const result = await aggregatedClient.callTool({
        name: 'query_prometheus',
        arguments: { query: 'up' },
      });

      expect(builtInClient.callTool).toHaveBeenCalledWith({
        name: 'query_prometheus',
        arguments: { query: 'up' },
      });
      expect(backendClient.callTool).not.toHaveBeenCalled();
      expect(result.content[0].text).toContain('Built-in result');
    });

    it('should route backend tools to backendClient', async () => {
      const result = await aggregatedClient.callTool({
        name: 'mcp-grafana_query_loki',
        arguments: { query: '{job="varlogs"}' },
      });

      expect(backendClient.callTool).toHaveBeenCalledWith({
        name: 'mcp-grafana_query_loki',
        arguments: { query: '{job="varlogs"}' },
      });
      expect(builtInClient.callTool).not.toHaveBeenCalled();
      expect(result.content[0].text).toContain('Backend result');
    });

    it('should pass tool names as-is (no manipulation)', async () => {
      await aggregatedClient.callTool({
        name: 'query_prometheus',
        arguments: {},
      });

      // Tool name should be passed exactly as-is
      expect(builtInClient.callTool).toHaveBeenCalledWith({
        name: 'query_prometheus', // No prefix added
        arguments: {},
      });
    });

    it('should pass scopeOrgId parameter through', async () => {
      await aggregatedClient.callTool({
        name: 'mcp-grafana_query_loki',
        arguments: {},
        scopeOrgId: 'tenant-123',
      });

      expect(backendClient.callTool).toHaveBeenCalledWith({
        name: 'mcp-grafana_query_loki',
        arguments: {},
        scopeOrgId: 'tenant-123',
      });
    });

    it('should return error for unknown tools', async () => {
      const result = await aggregatedClient.callTool({
        name: 'nonexistent_tool',
        arguments: {},
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('not available');
      expect(builtInClient.callTool).not.toHaveBeenCalled();
      expect(backendClient.callTool).not.toHaveBeenCalled();
    });

    it('should handle tool call errors gracefully', async () => {
      builtInClient.callTool.mockRejectedValueOnce(new Error('Tool execution failed'));

      const result = await aggregatedClient.callTool({
        name: 'query_prometheus',
        arguments: {},
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error calling tool');
    });
  });

  describe('getHealth', () => {
    it('should aggregate health from both sources', async () => {
      builtInClient = createMockBuiltInClient(builtInTools);
      backendClient = createMockBackendClient(backendTools);
      aggregatedClient = new AggregatedMCPClient({
        builtInClient,
        backendClient,
        useBuiltIn: true,
        useBackend: true,
      });

      const health = await aggregatedClient.getHealth();

      expect(health.status).toBe('healthy');
      expect(health.mcpServers).toBe(3); // 1 built-in + 2 backend
      expect(health.message).toContain('Built-in');
      expect(health.message).toContain('Backend');
    });

    it('should report partial availability when one source fails', async () => {
      builtInClient = createMockBuiltInClient([], true); // Fails
      backendClient = createMockBackendClient(backendTools);
      aggregatedClient = new AggregatedMCPClient({
        builtInClient,
        backendClient,
        useBuiltIn: true,
        useBackend: true,
      });

      const health = await aggregatedClient.getHealth();

      expect(health.status).toBe('degraded');
      expect(health.message).toContain('Built-in:');
      expect(health.message).toContain('Backend');
    });

    it('should report unhealthy when both sources fail', async () => {
      builtInClient = createMockBuiltInClient([], true);
      backendClient = createMockBackendClient([], true);
      aggregatedClient = new AggregatedMCPClient({
        builtInClient,
        backendClient,
        useBuiltIn: true,
        useBackend: true,
      });

      const health = await aggregatedClient.getHealth();

      expect(health.status).toBe('unhealthy');
    });
  });

  describe('clearCache', () => {
    it('should clear cache and registry from both clients', async () => {
      builtInClient = createMockBuiltInClient(builtInTools);
      backendClient = createMockBackendClient(backendTools);
      aggregatedClient = new AggregatedMCPClient({
        builtInClient,
        backendClient,
        useBuiltIn: true,
        useBackend: true,
      });

      await aggregatedClient.listTools();
      expect(aggregatedClient.isTool('query_prometheus')).toBe(true);

      aggregatedClient.clearCache();

      expect(builtInClient.clearCache).toHaveBeenCalled();
      expect(backendClient.clearCache).toHaveBeenCalled();
      expect(aggregatedClient.isTool('query_prometheus')).toBe(false);
    });
  });

  describe('disconnect', () => {
    it('should disconnect built-in client when enabled', async () => {
      builtInClient = createMockBuiltInClient(builtInTools);
      backendClient = createMockBackendClient(backendTools);
      aggregatedClient = new AggregatedMCPClient({
        builtInClient,
        backendClient,
        useBuiltIn: true,
        useBackend: true,
      });

      await aggregatedClient.disconnect();

      expect(builtInClient.disconnect).toHaveBeenCalled();
    });

    it('should not disconnect built-in client when disabled', async () => {
      builtInClient = createMockBuiltInClient(builtInTools);
      backendClient = createMockBackendClient(backendTools);
      aggregatedClient = new AggregatedMCPClient({
        builtInClient,
        backendClient,
        useBuiltIn: false,
        useBackend: true,
      });

      await aggregatedClient.disconnect();

      expect(builtInClient.disconnect).not.toHaveBeenCalled();
    });
  });

  describe('getStats', () => {
    it('should return correct statistics', async () => {
      builtInClient = createMockBuiltInClient(builtInTools);
      backendClient = createMockBackendClient(backendTools);
      aggregatedClient = new AggregatedMCPClient({
        builtInClient,
        backendClient,
        useBuiltIn: true,
        useBackend: true,
      });

      await aggregatedClient.listTools();
      const stats = aggregatedClient.getStats();

      expect(stats.builtInEnabled).toBe(true);
      expect(stats.backendEnabled).toBe(true);
      expect(stats.totalTools).toBe(4);
      expect(stats.builtInTools).toBe(2);
      expect(stats.backendTools).toBe(2);
    });
  });
});
