import { mcp } from '@grafana/llm';
import { config } from '@grafana/runtime';
import { BuiltInMCPClient } from '../builtInMCPClient';

// Mock dependencies
jest.mock('@grafana/llm');
jest.mock('@grafana/runtime', () => ({
  config: {
    bootData: {
      user: {
        orgRole: 'Admin',
      },
    },
  },
}));

describe('BuiltInMCPClient', () => {
  let client: BuiltInMCPClient;
  let mockMCPClient: any;

  beforeEach(() => {
    jest.clearAllMocks();
    client = new BuiltInMCPClient();

    // Mock MCP client
    mockMCPClient = {
      connect: jest.fn().mockResolvedValue(undefined),
      listTools: jest.fn().mockResolvedValue({ tools: [] }),
      callTool: jest.fn().mockResolvedValue({ content: [{ type: 'text', text: 'success' }] }),
      close: jest.fn().mockResolvedValue(undefined),
    };

    (mcp.Client as unknown as jest.Mock) = jest.fn().mockImplementation(() => mockMCPClient);
    (mcp.StreamableHTTPClientTransport as unknown as jest.Mock) = jest.fn();
    (mcp.streamableHTTPURL as jest.Mock) = jest.fn().mockReturnValue('http://test-url');
  });

  describe('isAvailable', () => {
    it('should check MCP availability', async () => {
      (mcp.enabled as jest.Mock).mockResolvedValue(true);
      const available = await client.isAvailable();
      expect(available).toBe(true);
      expect(mcp.enabled).toHaveBeenCalled();
    });

    it('should return false when MCP is unavailable', async () => {
      (mcp.enabled as jest.Mock).mockResolvedValue(false);
      const available = await client.isAvailable();
      expect(available).toBe(false);
    });

    it('should handle errors gracefully', async () => {
      (mcp.enabled as jest.Mock).mockRejectedValue(new Error('Connection failed'));
      const available = await client.isAvailable();
      expect(available).toBe(false);
    });
  });

  describe('listTools', () => {
    it('should list tools with RBAC filtering for Admin', async () => {
      (mcp.enabled as jest.Mock).mockResolvedValue(true);
      mockMCPClient.listTools.mockResolvedValue({
        tools: [
          { name: 'mcp-grafana_get_dashboard_by_uid', description: 'Get dashboard' },
          { name: 'mcp-grafana_create_dashboard', description: 'Create dashboard' },
        ],
      });

      const tools = await client.listTools();
      expect(tools).toHaveLength(2); // Admin gets all tools
      expect(tools.map((t) => t.name)).toEqual([
        'mcp-grafana_get_dashboard_by_uid',
        'mcp-grafana_create_dashboard',
      ]);
    });

    it('should filter tools for Viewer role', async () => {
      (config.bootData as any).user.orgRole = 'Viewer';
      (mcp.enabled as jest.Mock).mockResolvedValue(true);
      mockMCPClient.listTools.mockResolvedValue({
        tools: [
          { name: 'mcp-grafana_get_dashboard_by_uid', description: 'Get dashboard' },
          { name: 'mcp-grafana_create_dashboard', description: 'Create dashboard' },
        ],
      });

      const tools = await client.listTools();
      expect(tools).toHaveLength(1); // Viewer only gets get_dashboard
      expect(tools[0].name).toBe('mcp-grafana_get_dashboard_by_uid');
    });

    it('should return empty array when MCP is unavailable', async () => {
      (mcp.enabled as jest.Mock).mockResolvedValue(false);
      const tools = await client.listTools();
      expect(tools).toEqual([]);
    });

    it('should cache tools and apply RBAC on subsequent calls', async () => {
      (mcp.enabled as jest.Mock).mockResolvedValue(true);
      mockMCPClient.listTools.mockResolvedValue({
        tools: [{ name: 'mcp-grafana_get_dashboard_by_uid', description: 'Get dashboard' }],
      });

      // First call
      await client.listTools();
      expect(mockMCPClient.listTools).toHaveBeenCalledTimes(1);

      // Second call should use cache
      await client.listTools();
      expect(mockMCPClient.listTools).toHaveBeenCalledTimes(1); // Still 1, not called again
    });

    it('should handle connection errors', async () => {
      (mcp.enabled as jest.Mock).mockResolvedValue(true);
      mockMCPClient.connect.mockRejectedValue(new Error('Connection failed'));

      const tools = await client.listTools();
      expect(tools).toEqual([]);
    });
  });

  describe('callTool', () => {
    beforeEach(() => {
      (config.bootData as any).user.orgRole = 'Admin';
    });

    it('should call tool successfully for Admin', async () => {
      (mcp.enabled as jest.Mock).mockResolvedValue(true);
      mockMCPClient.listTools.mockResolvedValue({
        tools: [{ name: 'test_tool', description: 'Test tool' }],
      });

      const result = await client.callTool({ name: 'test_tool', arguments: { param: 'value' } });
      expect(result.content[0]).toHaveProperty('text', 'success');
      expect(mockMCPClient.callTool).toHaveBeenCalledWith({
        name: 'test_tool',
        arguments: { param: 'value' },
      });
    });

    it('should enforce RBAC when calling tool as Viewer', async () => {
      (config.bootData as any).user.orgRole = 'Viewer';
      (mcp.enabled as jest.Mock).mockResolvedValue(true);
      mockMCPClient.listTools.mockResolvedValue({
        tools: [{ name: 'mcp-grafana_create_dashboard', description: 'Create dashboard' }],
      });

      const result = await client.callTool({ name: 'mcp-grafana_create_dashboard' });
      expect(result.isError).toBe(true);
      const content = result.content[0];
      expect(content.type).toBe('text');
      if (content.type === 'text') {
        expect(content.text).toContain("don't have permission");
        expect(content.text).toContain('role: Viewer');
      }
      expect(mockMCPClient.callTool).not.toHaveBeenCalled();
    });

    it('should return error when tool does not exist', async () => {
      (mcp.enabled as jest.Mock).mockResolvedValue(true);
      mockMCPClient.listTools.mockResolvedValue({ tools: [] });

      const result = await client.callTool({ name: 'nonexistent_tool' });
      expect(result.isError).toBe(true);
      const content = result.content[0];
      expect(content.type).toBe('text');
      if (content.type === 'text') {
        expect(content.text).toContain('not available');
      }
    });

    it('should handle tool execution errors', async () => {
      (mcp.enabled as jest.Mock).mockResolvedValue(true);
      mockMCPClient.listTools.mockResolvedValue({
        tools: [{ name: 'test_tool', description: 'Test tool' }],
      });
      mockMCPClient.callTool.mockRejectedValue(new Error('Execution failed'));

      const result = await client.callTool({ name: 'test_tool' });
      expect(result.isError).toBe(true);
      const content = result.content[0];
      expect(content.type).toBe('text');
      if (content.type === 'text') {
        expect(content.text).toContain('Execution failed');
      }
    });
  });

  describe('isTool', () => {
    it('should return true for existing tool with permission', async () => {
      (mcp.enabled as jest.Mock).mockResolvedValue(true);
      mockMCPClient.listTools.mockResolvedValue({
        tools: [{ name: 'test_tool', description: 'Test tool' }],
      });

      await client.listTools(); // Populate cache
      expect(client.isTool('test_tool')).toBe(true);
    });

    it('should return false for tool without permission', async () => {
      (config.bootData as any).user.orgRole = 'Viewer';
      (mcp.enabled as jest.Mock).mockResolvedValue(true);
      mockMCPClient.listTools.mockResolvedValue({
        tools: [{ name: 'mcp-grafana_create_dashboard', description: 'Create dashboard' }],
      });

      await client.listTools(); // Populate cache
      expect(client.isTool('mcp-grafana_create_dashboard')).toBe(false);
    });

    it('should return false when cache is empty', () => {
      expect(client.isTool('test_tool')).toBe(false);
    });
  });

  describe('disconnect', () => {
    it('should disconnect gracefully', async () => {
      (mcp.enabled as jest.Mock).mockResolvedValue(true);
      await client.listTools(); // Connect first
      await client.disconnect();
      expect(mockMCPClient.close).toHaveBeenCalled();
    });

    it('should not throw when disconnecting without connection', async () => {
      await expect(client.disconnect()).resolves.not.toThrow();
    });

    it('should handle disconnection errors', async () => {
      (mcp.enabled as jest.Mock).mockResolvedValue(true);
      mockMCPClient.close.mockRejectedValue(new Error('Close failed'));
      await client.listTools(); // Connect first

      await expect(client.disconnect()).resolves.not.toThrow();
    });
  });

  describe('clearCache', () => {
    it('should clear cached tools', async () => {
      (mcp.enabled as jest.Mock).mockResolvedValue(true);
      mockMCPClient.listTools.mockResolvedValue({
        tools: [{ name: 'test_tool', description: 'Test tool' }],
      });

      // Populate cache
      await client.listTools();
      expect(mockMCPClient.listTools).toHaveBeenCalledTimes(1);

      // Clear and list again
      client.clearCache();
      await client.listTools();
      expect(mockMCPClient.listTools).toHaveBeenCalledTimes(2); // Called again after clear
    });
  });

  describe('getHealth', () => {
    it('should return ok status when available', async () => {
      (mcp.enabled as jest.Mock).mockResolvedValue(true);
      const health = await client.getHealth();
      expect(health.status).toBe('ok');
      expect(health.mcpServers).toBe(1);
    });

    it('should return unavailable status when MCP not available', async () => {
      (mcp.enabled as jest.Mock).mockResolvedValue(false);
      const health = await client.getHealth();
      expect(health.status).toBe('unavailable');
      expect(health.mcpServers).toBe(0);
    });

    it('should return error status on connection failure', async () => {
      (mcp.enabled as jest.Mock).mockResolvedValue(true);
      mockMCPClient.connect.mockRejectedValue(new Error('Connection failed'));
      const health = await client.getHealth();
      expect(health.status).toBe('error');
      expect(health.message).toContain('Connection failed');
    });
  });
});
