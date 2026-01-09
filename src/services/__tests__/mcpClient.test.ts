import { ExternalMCPClient, ExternalMCPManager, externalMCPManager } from '../mcpClient';
import type { MCPServerConfig } from '../../types/plugin';

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('ExternalMCPClient', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create client with config', () => {
      const config: MCPServerConfig = {
        id: 'test-1',
        name: 'Test Server',
        url: 'https://example.com',
        enabled: true,
        type: 'standard',
      };

      const client = new ExternalMCPClient(config);
      expect(client.getConfig()).toEqual(config);
    });
  });

  describe('isTool', () => {
    it('should return false when no tools are cached', () => {
      const config: MCPServerConfig = {
        id: 'test-1',
        name: 'Test Server',
        url: 'https://example.com',
        enabled: true,
        type: 'standard',
      };

      const client = new ExternalMCPClient(config);
      expect(client.isTool('any-tool')).toBe(false);
    });

    it('should return true when tool exists in cache', async () => {
      const config: MCPServerConfig = {
        id: 'test-1',
        name: 'Test Server',
        url: 'https://example.com',
        enabled: true,
        type: 'standard',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          tools: [{ name: 'my-tool', description: 'A test tool', inputSchema: {} }],
        }),
      });

      const client = new ExternalMCPClient(config);
      await client.listTools();

      expect(client.isTool('my-tool')).toBe(true);
      expect(client.isTool('unknown-tool')).toBe(false);
    });
  });

  describe('listTools', () => {
    it('should return empty list when server is disabled', async () => {
      const config: MCPServerConfig = {
        id: 'test-1',
        name: 'Test Server',
        url: 'https://example.com',
        enabled: false,
        type: 'standard',
      };

      const client = new ExternalMCPClient(config);
      const result = await client.listTools();

      expect(result.tools).toEqual([]);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should fetch tools from MCP server', async () => {
      const config: MCPServerConfig = {
        id: 'test-1',
        name: 'Test Server',
        url: 'https://example.com',
        enabled: true,
        type: 'standard',
      };

      const mockTools = [
        { name: 'tool1', description: 'Tool 1', inputSchema: {} },
        { name: 'tool2', description: 'Tool 2', inputSchema: {} },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ tools: mockTools }),
      });

      const client = new ExternalMCPClient(config);
      const result = await client.listTools();

      expect(result.tools).toEqual(mockTools);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.com/mcp/list-tools',
        expect.objectContaining({
          method: 'POST',
        })
      );
    });

    it('should handle URL with trailing slash', async () => {
      const config: MCPServerConfig = {
        id: 'test-1',
        name: 'Test Server',
        url: 'https://example.com/',
        enabled: true,
        type: 'standard',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ tools: [] }),
      });

      const client = new ExternalMCPClient(config);
      await client.listTools();

      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.com/mcp/list-tools',
        expect.any(Object)
      );
    });

    it('should return empty list on fetch error', async () => {
      const config: MCPServerConfig = {
        id: 'test-1',
        name: 'Test Server',
        url: 'https://example.com',
        enabled: true,
        type: 'standard',
      };

      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const client = new ExternalMCPClient(config);
      const result = await client.listTools();

      expect(result.tools).toEqual([]);
    });

    it('should return empty list on non-ok response', async () => {
      const config: MCPServerConfig = {
        id: 'test-1',
        name: 'Test Server',
        url: 'https://example.com',
        enabled: true,
        type: 'standard',
      };

      mockFetch.mockResolvedValueOnce({
        ok: false,
        statusText: 'Not Found',
      });

      const client = new ExternalMCPClient(config);
      const result = await client.listTools();

      expect(result.tools).toEqual([]);
    });

    describe('OpenAPI type', () => {
      it('should fetch and parse OpenAPI spec', async () => {
        const config: MCPServerConfig = {
          id: 'test-1',
          name: 'OpenAPI Server',
          url: 'https://api.example.com',
          enabled: true,
          type: 'openapi',
        };

        const openApiSpec = {
          paths: {
            '/users': {
              get: {
                operationId: 'getUsers',
                description: 'Get all users',
                parameters: [],
              },
              post: {
                operationId: 'createUser',
                summary: 'Create user',
                requestBody: {
                  content: {
                    'application/json': {
                      schema: {
                        properties: { name: { type: 'string' } },
                        required: ['name'],
                      },
                    },
                  },
                },
              },
            },
          },
        };

        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => openApiSpec,
        });

        const client = new ExternalMCPClient(config);
        const result = await client.listTools();

        expect(result.tools).toHaveLength(2);
        expect(result.tools[0].name).toBe('getUsers');
        expect(result.tools[1].name).toBe('createUser');
      });

      it('should handle URL ending with /openapi.json', async () => {
        const config: MCPServerConfig = {
          id: 'test-1',
          name: 'OpenAPI Server',
          url: 'https://api.example.com/openapi.json',
          enabled: true,
          type: 'openapi',
        };

        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ paths: {} }),
        });

        const client = new ExternalMCPClient(config);
        await client.listTools();

        expect(mockFetch).toHaveBeenCalledWith(
          'https://api.example.com/openapi.json',
          expect.any(Object)
        );
      });

      it('should generate tool name from path when no operationId', async () => {
        const config: MCPServerConfig = {
          id: 'test-1',
          name: 'OpenAPI Server',
          url: 'https://api.example.com',
          enabled: true,
          type: 'openapi',
        };

        const openApiSpec = {
          paths: {
            '/users/{id}': {
              get: {
                description: 'Get user by ID',
                parameters: [
                  { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
                ],
              },
            },
          },
        };

        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => openApiSpec,
        });

        const client = new ExternalMCPClient(config);
        const result = await client.listTools();

        expect(result.tools).toHaveLength(1);
        expect(result.tools[0].name).toBe('get_users_id');
      });
    });
  });

  describe('callTool', () => {
    it('should return error when server is disabled', async () => {
      const config: MCPServerConfig = {
        id: 'test-1',
        name: 'Test Server',
        url: 'https://example.com',
        enabled: false,
        type: 'standard',
      };

      const client = new ExternalMCPClient(config);
      const result = await client.callTool({ name: 'test', arguments: {} });

      expect(result.isError).toBe(true);
      const content = result.content[0];
      expect(content.type).toBe('text');
      expect('text' in content && content.text).toContain('disabled');
    });

    it('should call tool on MCP server', async () => {
      const config: MCPServerConfig = {
        id: 'test-1',
        name: 'Test Server',
        url: 'https://example.com',
        enabled: true,
        type: 'standard',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [{ type: 'text', text: 'Tool result' }],
        }),
      });

      const client = new ExternalMCPClient(config);
      const result = await client.callTool({ name: 'my-tool', arguments: { key: 'value' } });

      const content = result.content[0];
      expect(content.type).toBe('text');
      expect('text' in content && content.text).toBe('Tool result');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.com/mcp/call-tool',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ name: 'my-tool', arguments: { key: 'value' } }),
        })
      );
    });

    it('should return error on non-ok response', async () => {
      const config: MCPServerConfig = {
        id: 'test-1',
        name: 'Test Server',
        url: 'https://example.com',
        enabled: true,
        type: 'standard',
      };

      mockFetch.mockResolvedValueOnce({
        ok: false,
        statusText: 'Internal Server Error',
        text: async () => 'Something went wrong',
      });

      const client = new ExternalMCPClient(config);
      const result = await client.callTool({ name: 'my-tool', arguments: {} });

      expect(result.isError).toBe(true);
      const content = result.content[0];
      expect(content.type).toBe('text');
      expect('text' in content && content.text).toContain('Error calling tool');
    });

    it('should return error on fetch exception', async () => {
      const config: MCPServerConfig = {
        id: 'test-1',
        name: 'Test Server',
        url: 'https://example.com',
        enabled: true,
        type: 'standard',
      };

      mockFetch.mockRejectedValueOnce(new Error('Network failed'));

      const client = new ExternalMCPClient(config);
      const result = await client.callTool({ name: 'my-tool', arguments: {} });

      expect(result.isError).toBe(true);
      const content = result.content[0];
      expect(content.type).toBe('text');
      expect('text' in content && content.text).toContain('Network failed');
    });

    describe('OpenAPI type', () => {
      it('should execute OpenAPI operation', async () => {
        const config: MCPServerConfig = {
          id: 'test-1',
          name: 'OpenAPI Server',
          url: 'https://api.example.com',
          enabled: true,
          type: 'openapi',
        };

        const openApiSpec = {
          paths: {
            '/users': {
              get: {
                operationId: 'getUsers',
                description: 'Get all users',
              },
            },
          },
        };

        // First call fetches spec
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => openApiSpec,
        });

        // Second call executes the operation
        mockFetch.mockResolvedValueOnce({
          ok: true,
          headers: new Map([['content-type', 'application/json']]),
          json: async () => [{ id: 1, name: 'User 1' }],
        });

        const client = new ExternalMCPClient(config);
        await client.listTools(); // Populate cache
        const result = await client.callTool({ name: 'getUsers', arguments: {} });

        expect(result.isError).toBeUndefined();
        const content = result.content[0];
        expect(content.type).toBe('text');
        expect('text' in content && content.text).toContain('User 1');
      });

      it('should handle path parameters', async () => {
        const config: MCPServerConfig = {
          id: 'test-1',
          name: 'OpenAPI Server',
          url: 'https://api.example.com',
          enabled: true,
          type: 'openapi',
        };

        const openApiSpec = {
          paths: {
            '/users/{id}': {
              get: {
                operationId: 'getUser',
                parameters: [{ name: 'id', in: 'path', required: true }],
              },
            },
          },
        };

        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => openApiSpec,
        });

        mockFetch.mockResolvedValueOnce({
          ok: true,
          headers: new Map([['content-type', 'application/json']]),
          json: async () => ({ id: 123, name: 'User 123' }),
        });

        const client = new ExternalMCPClient(config);
        await client.listTools();
        await client.callTool({ name: 'getUser', arguments: { id: '123' } });

        // Second fetch call should have the path parameter replaced
        expect(mockFetch).toHaveBeenLastCalledWith(
          'https://api.example.com/users/123',
          expect.any(Object)
        );
      });

      it('should handle query parameters', async () => {
        const config: MCPServerConfig = {
          id: 'test-1',
          name: 'OpenAPI Server',
          url: 'https://api.example.com',
          enabled: true,
          type: 'openapi',
        };

        const openApiSpec = {
          paths: {
            '/users': {
              get: {
                operationId: 'searchUsers',
                parameters: [{ name: 'name', in: 'query' }],
              },
            },
          },
        };

        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => openApiSpec,
        });

        mockFetch.mockResolvedValueOnce({
          ok: true,
          headers: new Map([['content-type', 'application/json']]),
          json: async () => [],
        });

        const client = new ExternalMCPClient(config);
        await client.listTools();
        await client.callTool({ name: 'searchUsers', arguments: { name: 'John' } });

        expect(mockFetch).toHaveBeenLastCalledWith(
          'https://api.example.com/users?name=John',
          expect.any(Object)
        );
      });

      it('should return error for unknown tool', async () => {
        const config: MCPServerConfig = {
          id: 'test-1',
          name: 'OpenAPI Server',
          url: 'https://api.example.com',
          enabled: true,
          type: 'openapi',
        };

        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ paths: {} }),
        });

        const client = new ExternalMCPClient(config);
        await client.listTools();
        const result = await client.callTool({ name: 'unknownTool', arguments: {} });

        expect(result.isError).toBe(true);
        const content = result.content[0];
        expect(content.type).toBe('text');
        expect('text' in content && content.text).toContain('not found');
      });
    });
  });
});

describe('ExternalMCPManager', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('initialize', () => {
    it('should initialize clients from configs', () => {
      const manager = new ExternalMCPManager();
      const configs: MCPServerConfig[] = [
        { id: '1', name: 'Server 1', url: 'https://example1.com', enabled: true, type: 'standard' },
        { id: '2', name: 'Server 2', url: 'https://example2.com', enabled: true, type: 'openapi' },
      ];

      manager.initialize(configs);

      // We can't directly check the internal map, but we can test behavior
      expect(() => manager.isTool('any-tool')).not.toThrow();
    });

    it('should skip disabled servers', () => {
      const manager = new ExternalMCPManager();
      const configs: MCPServerConfig[] = [
        { id: '1', name: 'Server 1', url: 'https://example.com', enabled: false, type: 'standard' },
      ];

      manager.initialize(configs);

      // Should not throw even with no clients
      expect(manager.isTool('any-tool')).toBe(false);
    });

    it('should skip servers without URL', () => {
      const manager = new ExternalMCPManager();
      const configs: MCPServerConfig[] = [
        { id: '1', name: 'Server 1', url: '', enabled: true, type: 'standard' },
      ];

      manager.initialize(configs);

      expect(manager.isTool('any-tool')).toBe(false);
    });
  });

  describe('listAllTools', () => {
    it('should list tools from all clients', async () => {
      const manager = new ExternalMCPManager();
      const configs: MCPServerConfig[] = [
        { id: '1', name: 'Server 1', url: 'https://example1.com', enabled: true, type: 'standard' },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          tools: [{ name: 'tool1', description: 'Tool 1' }],
        }),
      });

      manager.initialize(configs);
      const tools = await manager.listAllTools();

      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('tool1');
    });

    it('should handle errors from individual clients', async () => {
      const manager = new ExternalMCPManager();
      const configs: MCPServerConfig[] = [
        { id: '1', name: 'Server 1', url: 'https://example1.com', enabled: true, type: 'standard' },
      ];

      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      manager.initialize(configs);
      const tools = await manager.listAllTools();

      // Should return empty array, not throw
      expect(tools).toEqual([]);
    });
  });

  describe('callTool', () => {
    it('should call tool on correct client', async () => {
      const manager = new ExternalMCPManager();
      const configs: MCPServerConfig[] = [
        { id: '1', name: 'Server 1', url: 'https://example1.com', enabled: true, type: 'standard' },
      ];

      // First call: listTools to populate cache
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          tools: [{ name: 'my-tool', description: 'My Tool' }],
        }),
      });

      // Second call: callTool
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [{ type: 'text', text: 'Result' }],
        }),
      });

      manager.initialize(configs);
      await manager.listAllTools(); // Populate tool cache
      const result = await manager.callTool({ name: 'my-tool', arguments: {} });

      expect(result).not.toBeNull();
      const content = result!.content[0];
      expect(content.type).toBe('text');
      expect('text' in content && content.text).toBe('Result');
    });

    it('should return null when no client handles tool', async () => {
      const manager = new ExternalMCPManager();
      manager.initialize([]);

      const result = await manager.callTool({ name: 'unknown-tool', arguments: {} });

      expect(result).toBeNull();
    });
  });

  describe('isTool', () => {
    it('should return true when a client handles the tool', async () => {
      const manager = new ExternalMCPManager();
      const configs: MCPServerConfig[] = [
        { id: '1', name: 'Server 1', url: 'https://example1.com', enabled: true, type: 'standard' },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          tools: [{ name: 'my-tool', description: 'My Tool' }],
        }),
      });

      manager.initialize(configs);
      await manager.listAllTools();

      expect(manager.isTool('my-tool')).toBe(true);
      expect(manager.isTool('unknown-tool')).toBe(false);
    });
  });
});

describe('externalMCPManager singleton', () => {
  it('should be an instance of ExternalMCPManager', () => {
    expect(externalMCPManager).toBeInstanceOf(ExternalMCPManager);
  });
});

