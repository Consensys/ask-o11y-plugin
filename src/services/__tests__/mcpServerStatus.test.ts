import { MCPServerStatusService, mcpServerStatusService } from '../mcpServerStatus';

// Mock @grafana/runtime
jest.mock('@grafana/runtime', () => ({
  getBackendSrv: () => ({
    fetch: jest.fn().mockReturnValue({
      toPromise: () =>
        Promise.resolve({
          data: {
            servers: [
              {
                serverId: 'server-1',
                name: 'Test Server',
                url: 'http://localhost:8080',
                type: 'sse',
                status: 'healthy',
                lastCheck: '2024-01-01T00:00:00Z',
                responseTime: 50,
                successRate: 100,
                errorCount: 0,
                consecutiveFailures: 0,
                tools: [{ name: 'test_tool', description: 'A test tool', inputSchema: {} }],
                toolCount: 1,
              },
            ],
            systemHealth: {
              overallStatus: 'healthy',
              healthy: 1,
              degraded: 0,
              unhealthy: 0,
              disconnected: 0,
              total: 1,
            },
          },
        }),
    }),
  }),
}));

describe('MCPServerStatusService', () => {
  let service: MCPServerStatusService;

  beforeEach(() => {
    service = new MCPServerStatusService();
  });

  describe('fetchServerStatuses', () => {
    it('should fetch server statuses from backend', async () => {
      const result = await service.fetchServerStatuses();

      expect(result.servers).toHaveLength(1);
      expect(result.servers[0].serverId).toBe('server-1');
      expect(result.servers[0].status).toBe('healthy');
      expect(result.systemHealth.overallStatus).toBe('healthy');
    });

    it('should include tools in response', async () => {
      const result = await service.fetchServerStatuses();

      expect(result.servers[0].tools).toHaveLength(1);
      expect(result.servers[0].tools[0].name).toBe('test_tool');
    });
  });

  describe('fetchServerStatus', () => {
    it('should return specific server status', async () => {
      const result = await service.fetchServerStatus('server-1');

      expect(result).not.toBeNull();
      expect(result!.serverId).toBe('server-1');
    });

    it('should return null for non-existent server', async () => {
      const result = await service.fetchServerStatus('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('singleton instance', () => {
    it('should export singleton instance', () => {
      expect(mcpServerStatusService).toBeInstanceOf(MCPServerStatusService);
    });
  });
});

describe('MCPServerStatusService error handling', () => {
  it('should return empty response on error', async () => {
    // Create a new mock that rejects
    jest.resetModules();
    jest.doMock('@grafana/runtime', () => ({
      getBackendSrv: () => ({
        fetch: jest.fn().mockReturnValue({
          toPromise: () => Promise.reject(new Error('Network error')),
        }),
      }),
    }));

    // Re-import after mocking
    const { MCPServerStatusService: ErrorService } = require('../mcpServerStatus');
    const errorService = new ErrorService();

    const result = await errorService.fetchServerStatuses();

    expect(result.servers).toEqual([]);
    expect(result.systemHealth.overallStatus).toBe('unhealthy');
    expect(result.systemHealth.total).toBe(0);
  });

  it('should return empty response when response data is null', async () => {
    jest.resetModules();
    jest.doMock('@grafana/runtime', () => ({
      getBackendSrv: () => ({
        fetch: jest.fn().mockReturnValue({
          toPromise: () => Promise.resolve(null),
        }),
      }),
    }));

    const { MCPServerStatusService: NullService } = require('../mcpServerStatus');
    const nullService = new NullService();

    const result = await nullService.fetchServerStatuses();

    expect(result.servers).toEqual([]);
    expect(result.systemHealth.overallStatus).toBe('unhealthy');
  });
});

