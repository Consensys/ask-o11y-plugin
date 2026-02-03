import { of, throwError } from 'rxjs';
import { BackendMCPClient, backendMCPClient } from '../backendMCPClient';

// Create a mock fetch function that we can control
const mockFetch = jest.fn();

// Mock @grafana/runtime
jest.mock('@grafana/runtime', () => ({
  getBackendSrv: () => ({
    fetch: mockFetch,
  }),
  config: {
    bootData: {
      user: {
        orgName: 'TestOrg',
      },
    },
  },
}));

const setupSuccessMocks = () => {
  mockFetch.mockImplementation(({ url, method }) => {
    if (url.includes('/api/mcp/tools') && method === 'GET') {
      return of({
        data: {
          tools: [
            { name: 'prometheus_query', description: 'Query Prometheus', inputSchema: {} },
            { name: 'loki_query', description: 'Query Loki', inputSchema: {} },
          ],
        },
      });
    }
    if (url.includes('/api/mcp/call-tool') && method === 'POST') {
      return of({
        data: {
          content: [{ type: 'text', text: 'Tool result' }],
          isError: false,
        },
      });
    }
    if (url.includes('/health') && method === 'GET') {
      return of({
        data: {
          status: 'ok',
          mcpServers: 2,
          message: 'All servers healthy',
        },
      });
    }
    return throwError(() => new Error('Unknown endpoint'));
  });
};

describe('BackendMCPClient', () => {
  let client: BackendMCPClient;

  beforeEach(() => {
    mockFetch.mockReset();
    setupSuccessMocks();
    client = new BackendMCPClient();
    client.clearCache();
  });

  describe('listTools', () => {
    it('should list tools from backend', async () => {
      const tools = await client.listTools();

      expect(tools).toHaveLength(2);
      expect(tools[0].name).toBe('prometheus_query');
      expect(tools[1].name).toBe('loki_query');
    });

    it('should cache tools after first call', async () => {
      const tools1 = await client.listTools();
      const tools2 = await client.listTools();

      expect(tools1).toEqual(tools2);
    });

    it('should return empty array on error', async () => {
      mockFetch.mockImplementation(() => throwError(() => new Error('Network error')));

      const tools = await client.listTools();

      expect(tools).toEqual([]);
    });
  });

  describe('callTool', () => {
    it('should call tool via backend', async () => {
      const result = await client.callTool({
        name: 'prometheus_query',
        arguments: { query: 'up' },
      });

      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
      expect(result.isError).toBe(false);
    });

    it('should return error result when no response', async () => {
      mockFetch.mockImplementation(() => of(undefined));

      const result = await client.callTool({
        name: 'test_tool',
        arguments: {},
      });

      expect(result.isError).toBe(true);
      const content = result.content[0];
      expect(content.type).toBe('text');
      expect('text' in content && content.text).toContain('Error calling tool');
    });

    it('should return error result on exception', async () => {
      mockFetch.mockImplementation(() => throwError(() => new Error('API error')));

      const result = await client.callTool({
        name: 'test_tool',
        arguments: {},
      });

      expect(result.isError).toBe(true);
      const content = result.content[0];
      expect(content.type).toBe('text');
      expect('text' in content && content.text).toContain('API error');
    });

    it('should include scopeOrgId when provided', async () => {
      await client.callTool({
        name: 'prometheus_query',
        arguments: { query: 'up' },
        scopeOrgId: 'tenant-123',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            scopeOrgId: 'tenant-123',
          }),
        })
      );
    });
  });

  describe('isTool', () => {
    it('should return false when tools not cached', () => {
      expect(client.isTool('prometheus_query')).toBe(false);
    });

    it('should return true for cached tool', async () => {
      await client.listTools();
      expect(client.isTool('prometheus_query')).toBe(true);
    });

    it('should return false for non-existent tool', async () => {
      await client.listTools();
      expect(client.isTool('non_existent_tool')).toBe(false);
    });
  });

  describe('clearCache', () => {
    it('should clear cached tools', async () => {
      await client.listTools();
      expect(client.isTool('prometheus_query')).toBe(true);

      client.clearCache();
      expect(client.isTool('prometheus_query')).toBe(false);
    });
  });

  describe('getHealth', () => {
    it('should get health status from backend', async () => {
      const health = await client.getHealth();

      expect(health.status).toBe('ok');
      expect(health.mcpServers).toBe(2);
      expect(health.message).toBe('All servers healthy');
    });

    it('should return error status when no response', async () => {
      mockFetch.mockImplementation(() => of(undefined));

      const health = await client.getHealth();

      expect(health.status).toBe('error');
      expect(health.mcpServers).toBe(0);
      expect(health.message).toBe('Failed to connect to backend');
    });

    it('should return error status on exception', async () => {
      mockFetch.mockImplementation(() => throwError(() => new Error('Connection refused')));

      const health = await client.getHealth();

      expect(health.status).toBe('error');
      expect(health.mcpServers).toBe(0);
    });
  });

  describe('singleton instance', () => {
    it('should export singleton instance', () => {
      expect(backendMCPClient).toBeInstanceOf(BackendMCPClient);
    });
  });
});
