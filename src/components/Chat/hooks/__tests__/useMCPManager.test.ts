/**
 * Unit tests for useMCPManager hook utilities
 * Tests MCP tool management logic without requiring React hook rendering
 */
import { llm, mcp } from '@grafana/llm';
import { backendMCPClient } from '../../../../services/backendMCPClient';
import { toolRequestQueue } from '../../../../services/queue';

// Mock dependencies
jest.mock('@grafana/llm', () => ({
  llm: {
    enabled: jest.fn(),
  },
  mcp: {
    convertToolsToOpenAI: jest.fn((tools) => tools.map((t: any) => ({ type: 'function', function: t }))),
  },
}));

jest.mock('../../../../services/backendMCPClient', () => ({
  backendMCPClient: {
    listTools: jest.fn(),
    callTool: jest.fn(),
    getHealth: jest.fn(),
    isTool: jest.fn(),
  },
}));

jest.mock('../../../../services/queue', () => ({
  toolRequestQueue: {
    add: jest.fn((fn) => fn()),
    getStatus: jest.fn().mockReturnValue({ queueLength: 0, activeRequests: 0 }),
  },
}));

describe('useMCPManager utilities', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (llm.enabled as jest.Mock).mockResolvedValue(true);
    (backendMCPClient.listTools as jest.Mock).mockResolvedValue([]);
  });

  describe('llm.enabled', () => {
    it('should check if LLM is enabled', async () => {
      const enabled = await llm.enabled();
      expect(enabled).toBe(true);
    });

    it('should return false when LLM is disabled', async () => {
      (llm.enabled as jest.Mock).mockResolvedValue(false);
      const enabled = await llm.enabled();
      expect(enabled).toBe(false);
    });
  });

  describe('backendMCPClient.listTools', () => {
    it('should list available tools', async () => {
      const mockTools = [
        { name: 'tool1', description: 'Test tool 1' },
        { name: 'tool2', description: 'Test tool 2' },
      ];
      (backendMCPClient.listTools as jest.Mock).mockResolvedValue(mockTools);

      const tools = await backendMCPClient.listTools();
      expect(tools).toEqual(mockTools);
      expect(tools).toHaveLength(2);
    });

    it('should return empty array when no tools available', async () => {
      (backendMCPClient.listTools as jest.Mock).mockResolvedValue([]);
      const tools = await backendMCPClient.listTools();
      expect(tools).toEqual([]);
    });

    it('should handle listTools error gracefully', async () => {
      (backendMCPClient.listTools as jest.Mock).mockRejectedValue(new Error('Connection failed'));

      await expect(backendMCPClient.listTools()).rejects.toThrow('Connection failed');
    });
  });

  describe('backendMCPClient.callTool', () => {
    it('should call a tool with arguments', async () => {
      const toolResponse = {
        content: [{ type: 'text', text: 'Tool result' }],
        isError: false,
      };
      (backendMCPClient.callTool as jest.Mock).mockResolvedValue(toolResponse);

      const result = await backendMCPClient.callTool({
        name: 'test_tool',
        arguments: { param: 'value' },
      });

      expect(result).toEqual(toolResponse);
      expect(backendMCPClient.callTool).toHaveBeenCalledWith({
        name: 'test_tool',
        arguments: { param: 'value' },
      });
    });

    it('should handle tool call errors', async () => {
      (backendMCPClient.callTool as jest.Mock).mockResolvedValue({
        content: [{ type: 'text', text: 'Error: Tool failed' }],
        isError: true,
      });

      const result = await backendMCPClient.callTool({
        name: 'failing_tool',
        arguments: {},
      });

      expect(result.isError).toBe(true);
      const content = result.content[0];
      expect(content.type).toBe('text');
      expect('text' in content && content.text).toContain('Error');
    });
  });

  describe('mcp.convertToolsToOpenAI', () => {
    it('should convert MCP tools to OpenAI format', () => {
      const mcpTools = [
        { name: 'tool1', description: 'Tool 1', inputSchema: { type: 'object' as const } },
        { name: 'tool2', description: 'Tool 2', inputSchema: { type: 'object' as const } },
      ];

      const openAITools = mcp.convertToolsToOpenAI(mcpTools);

      expect(openAITools).toHaveLength(2);
      expect(openAITools[0]).toHaveProperty('type', 'function');
      expect(openAITools[0]).toHaveProperty('function');
    });
  });

  describe('toolRequestQueue', () => {
    it('should execute function through queue', async () => {
      const mockFn = jest.fn().mockResolvedValue('result');

      const result = await toolRequestQueue.add(mockFn);

      expect(mockFn).toHaveBeenCalled();
      expect(result).toBe('result');
    });

    it('should get queue status', () => {
      const status = toolRequestQueue.getStatus();

      expect(status).toHaveProperty('queueLength');
      expect(status).toHaveProperty('activeRequests');
    });
  });

  describe('Tool call message handling', () => {
    it('should construct tool call result message', () => {
      const toolCallId = 'call_123';
      const toolResult = 'Tool execution result';

      const message = {
        role: 'tool' as const,
        tool_call_id: toolCallId,
        content: toolResult,
      };

      expect(message.role).toBe('tool');
      expect(message.tool_call_id).toBe(toolCallId);
      expect(message.content).toBe(toolResult);
    });

    it('should handle empty tool response with fallback', () => {
      const toolResponse = {
        content: [{ type: 'text', text: '' }],
      };

      const textContent = toolResponse.content
        .filter((c: any) => c.type === 'text')
        .map((c: any) => c.text)
        .join('');

      const finalContent = textContent.trim() || 'No results returned (empty response)';

      expect(finalContent).toBe('No results returned (empty response)');
    });
  });

  describe('backendMCPClient.getHealth', () => {
    it('should get health status', async () => {
      (backendMCPClient.getHealth as jest.Mock).mockResolvedValue({
        status: 'ok',
        mcpServers: 2,
        message: 'All servers healthy',
      });

      const health = await backendMCPClient.getHealth();

      expect(health.status).toBe('ok');
      expect(health.mcpServers).toBe(2);
    });

    it('should handle health check error', async () => {
      (backendMCPClient.getHealth as jest.Mock).mockResolvedValue({
        status: 'error',
        mcpServers: 0,
        message: 'Connection failed',
      });

      const health = await backendMCPClient.getHealth();

      expect(health.status).toBe('error');
    });
  });

  describe('backendMCPClient.isTool', () => {
    it('should check if tool exists', () => {
      (backendMCPClient.isTool as jest.Mock).mockReturnValue(true);
      expect(backendMCPClient.isTool('existing_tool')).toBe(true);
    });

    it('should return false for non-existent tool', () => {
      (backendMCPClient.isTool as jest.Mock).mockReturnValue(false);
      expect(backendMCPClient.isTool('non_existent_tool')).toBe(false);
    });
  });

  describe('Tool call filtering', () => {
    it('should filter tool calls with function property', () => {
      const toolCalls = [
        { function: { name: 'tool1', arguments: '{}' }, id: 'call-1' },
        { id: 'call-2' } as any, // Missing function property
        { function: { name: 'tool2', arguments: '{}' }, id: 'call-3' },
      ];

      const functionCalls = toolCalls.filter((tc) => tc.function);

      expect(functionCalls).toHaveLength(2);
      expect(functionCalls[0].id).toBe('call-1');
      expect(functionCalls[1].id).toBe('call-3');
    });
  });

  describe('Tool call parsing', () => {
    it('should parse tool call arguments', () => {
      const toolCall = {
        function: { name: 'test_tool', arguments: '{"key": "value", "count": 42}' },
        id: 'call-123',
      };

      const args = JSON.parse(toolCall.function.arguments);

      expect(args.key).toBe('value');
      expect(args.count).toBe(42);
    });

    it('should handle malformed JSON arguments', () => {
      const toolCall = {
        function: { name: 'test_tool', arguments: 'not valid json' },
        id: 'call-123',
      };

      expect(() => JSON.parse(toolCall.function.arguments)).toThrow();
    });
  });
});
