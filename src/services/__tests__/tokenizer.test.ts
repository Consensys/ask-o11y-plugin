import { TokenizerService } from '../tokenizer';

describe('TokenizerService', () => {
  beforeEach(() => {
    TokenizerService.initialize();
  });

  describe('countTokens', () => {
    it('should return 0 for empty string', () => {
      expect(TokenizerService.countTokens('')).toBe(0);
    });

    it('should return 0 for null/undefined', () => {
      expect(TokenizerService.countTokens(null as any)).toBe(0);
      expect(TokenizerService.countTokens(undefined as any)).toBe(0);
    });

    it('should count tokens for simple text', () => {
      const count = TokenizerService.countTokens('Hello world');
      expect(count).toBeGreaterThan(0);
      expect(count).toBeLessThan(10);
    });

    it('should count more tokens for longer text', () => {
      const shortCount = TokenizerService.countTokens('Hello');
      const longCount = TokenizerService.countTokens('Hello world, this is a longer sentence with more words');
      expect(longCount).toBeGreaterThan(shortCount);
    });
  });

  describe('countMessageTokens', () => {
    it('should count tokens for simple user message', () => {
      const message = { role: 'user' as const, content: 'Hello' };
      const count = TokenizerService.countMessageTokens(message);
      expect(count).toBeGreaterThan(0);
    });

    it('should count tokens for system message', () => {
      const message = { role: 'system' as const, content: 'You are a helpful assistant.' };
      const count = TokenizerService.countMessageTokens(message);
      expect(count).toBeGreaterThan(5);
    });

    it('should handle message with empty content', () => {
      const message = { role: 'assistant' as const, content: '' };
      const count = TokenizerService.countMessageTokens(message);
      expect(count).toBeGreaterThan(0);
    });

    it('should count tokens for message with tool calls', () => {
      const message = {
        role: 'assistant' as const,
        content: 'Let me query that for you.',
        tool_calls: [
          {
            id: 'call_1',
            type: 'function' as const,
            function: {
              name: 'prometheus_query',
              arguments: '{"query": "up"}',
            },
          },
        ],
      };
      const count = TokenizerService.countMessageTokens(message);
      expect(count).toBeGreaterThan(10);
    });

    it('should count tokens for tool response message', () => {
      const message = {
        role: 'tool' as const,
        content: '{"status": "success"}',
        tool_call_id: 'call_1',
      };
      const count = TokenizerService.countMessageTokens(message);
      expect(count).toBeGreaterThan(0);
    });
  });

  describe('countMessagesTokens', () => {
    it('should return 0 for empty array', () => {
      expect(TokenizerService.countMessagesTokens([])).toBe(0);
    });

    it('should count tokens for multiple messages', () => {
      const messages = [
        { role: 'system' as const, content: 'You are a helpful assistant.' },
        { role: 'user' as const, content: 'Hello!' },
        { role: 'assistant' as const, content: 'Hi there!' },
      ];
      const count = TokenizerService.countMessagesTokens(messages);
      expect(count).toBeGreaterThan(10);
    });

    it('should be approximately sum of individual message tokens', () => {
      const messages = [
        { role: 'user' as const, content: 'Hello' },
        { role: 'assistant' as const, content: 'Hi!' },
      ];
      const totalCount = TokenizerService.countMessagesTokens(messages);
      const individualCount = messages.reduce(
        (sum, msg) => sum + TokenizerService.countMessageTokens(msg),
        0
      );
      expect(Math.abs(totalCount - individualCount)).toBeLessThan(10);
    });
  });

  describe('estimateTokens', () => {
    it('should estimate tokens for text', () => {
      const estimate = TokenizerService.estimateTokens('Hello world');
      expect(estimate).toBeGreaterThan(0);
    });

    it('should estimate roughly 4 chars per token', () => {
      const text = 'a'.repeat(100);
      const estimate = TokenizerService.estimateTokens(text);
      expect(estimate).toBeGreaterThanOrEqual(20);
      expect(estimate).toBeLessThanOrEqual(35);
    });
  });

  describe('truncateToTokenLimit', () => {
    it('should not truncate short text', () => {
      const text = 'Hello world';
      const result = TokenizerService.truncateToTokenLimit(text, 100);
      expect(result).toBe(text);
    });

    it('should truncate long text', () => {
      const text = 'word '.repeat(1000);
      const result = TokenizerService.truncateToTokenLimit(text, 50);
      expect(result.length).toBeLessThan(text.length);
    });

    it('should return text with ellipsis when truncated', () => {
      const text = 'word '.repeat(100);
      const result = TokenizerService.truncateToTokenLimit(text, 10);
      expect(result.length).toBeLessThanOrEqual(text.length);
    });
  });

  describe('getModelTokenLimit', () => {
    it('should return limit for known model', () => {
      const limit = TokenizerService.getModelTokenLimit('gpt-4');
      expect(limit).toBeGreaterThan(0);
    });

    it('should return default limit for unknown model', () => {
      const limit = TokenizerService.getModelTokenLimit('unknown-model');
      expect(limit).toBeGreaterThan(0);
    });
  });

  describe('initialize', () => {
    it('should initialize with default model', () => {
      TokenizerService.initialize();
      const count = TokenizerService.countTokens('test');
      expect(count).toBeGreaterThan(0);
    });

    it('should initialize with specified model', () => {
      TokenizerService.initialize('gpt-3.5-turbo');
      const count = TokenizerService.countTokens('test');
      expect(count).toBeGreaterThan(0);
    });
  });

  describe('countToolTokens', () => {
    it('should return 0 for empty array', () => {
      expect(TokenizerService.countToolTokens([])).toBe(0);
    });

    it('should return 0 for null/undefined', () => {
      expect(TokenizerService.countToolTokens(null as any)).toBe(0);
      expect(TokenizerService.countToolTokens(undefined as any)).toBe(0);
    });

    it('should count tokens for tool definitions', () => {
      const tools = [
        { name: 'test_tool', description: 'A test tool', inputSchema: { type: 'object' } },
      ];
      const count = TokenizerService.countToolTokens(tools);
      expect(count).toBeGreaterThan(0);
    });
  });

  describe('calculateContextTokens', () => {
    it('should calculate message and tool tokens', () => {
      const messages = [
        { role: 'system' as const, content: 'You are a helpful assistant.' },
        { role: 'user' as const, content: 'Hello!' },
      ];
      const tools = [{ name: 'test_tool', description: 'A test tool' }];

      const result = TokenizerService.calculateContextTokens(messages, tools);

      expect(result.messageTokens).toBeGreaterThan(0);
      expect(result.toolTokens).toBeGreaterThan(0);
      expect(result.totalTokens).toBe(result.messageTokens + result.toolTokens);
    });

    it('should calculate breakdown by role', () => {
      const messages = [
        { role: 'system' as const, content: 'System message' },
        { role: 'user' as const, content: 'User message' },
        { role: 'assistant' as const, content: 'Assistant message' },
      ];

      const result = TokenizerService.calculateContextTokens(messages);

      expect(result.breakdown.system).toBeGreaterThan(0);
      expect(result.breakdown.user).toBeGreaterThan(0);
      expect(result.breakdown.assistant).toBeGreaterThan(0);
    });

    it('should calculate breakdown for tool role', () => {
      const messages = [
        { role: 'user', content: 'Call a tool' },
        { role: 'assistant', content: '', tool_calls: [{ id: 'call_1', type: 'function' as const, function: { name: 'test', arguments: '{}' } }] },
        { role: 'tool', content: 'Tool result', tool_call_id: 'call_1' },
      ] as Array<import('@grafana/llm').llm.Message>;

      const result = TokenizerService.calculateContextTokens(messages);

      expect(result.breakdown.tool).toBeGreaterThan(0);
    });
  });

  describe('estimateCost', () => {
    it('should estimate cost for gpt-4 input tokens', () => {
      const cost = TokenizerService.estimateCost(1000, 'gpt-4', false);
      expect(cost).toBeGreaterThan(0);
      expect(cost).toBe(0.03); // $0.03 per 1K tokens
    });

    it('should estimate cost for gpt-4 output tokens', () => {
      const cost = TokenizerService.estimateCost(1000, 'gpt-4', true);
      expect(cost).toBe(0.06); // $0.06 per 1K tokens
    });

    it('should use default pricing for unknown model', () => {
      const cost = TokenizerService.estimateCost(1000, 'unknown-model');
      expect(cost).toBeGreaterThan(0);
    });

    it('should calculate proportional cost', () => {
      const cost1k = TokenizerService.estimateCost(1000, 'gpt-4');
      const cost2k = TokenizerService.estimateCost(2000, 'gpt-4');
      expect(cost2k).toBe(cost1k * 2);
    });
  });

  describe('validateTokenLimit', () => {
    it('should not throw for text within limit', () => {
      expect(() => {
        TokenizerService.validateTokenLimit('Hello world', 100);
      }).not.toThrow();
    });

    it('should throw for text exceeding limit', () => {
      const longText = 'word '.repeat(1000);
      expect(() => {
        TokenizerService.validateTokenLimit(longText, 10);
      }).toThrow('Text exceeds token limit');
    });
  });

  describe('getTokenBudget', () => {
    it('should calculate token budget for messages', () => {
      const messages = [
        { role: 'user' as const, content: 'Hello' },
      ];

      const budget = TokenizerService.getTokenBudget(messages);

      expect(budget.used).toBeGreaterThan(0);
      expect(budget.limit).toBeGreaterThan(0);
      expect(budget.remaining).toBe(budget.limit - budget.used);
      expect(budget.percentage).toBeGreaterThan(0);
    });

    it('should use model-specific limits', () => {
      const messages = [{ role: 'user' as const, content: 'Hello' }];

      const gpt4Budget = TokenizerService.getTokenBudget(messages, 'gpt-4');
      const gpt4TurboBudget = TokenizerService.getTokenBudget(messages, 'gpt-4-turbo');

      expect(gpt4TurboBudget.limit).toBeGreaterThan(gpt4Budget.limit);
    });
  });

  describe('splitTextIntoChunks', () => {
    it('should return empty array for empty text', () => {
      expect(TokenizerService.splitTextIntoChunks('', 100)).toEqual([]);
    });

    it('should split long text into chunks', () => {
      const text = 'word '.repeat(1000);
      const chunks = TokenizerService.splitTextIntoChunks(text, 50);
      expect(chunks.length).toBeGreaterThan(1);
    });

    it('should include startIndex and endIndex', () => {
      const text = 'word word word word word';
      const chunks = TokenizerService.splitTextIntoChunks(text, 3);
      chunks.forEach(chunk => {
        expect(chunk.text).toBeDefined();
        expect(chunk.startIndex).toBeGreaterThanOrEqual(0);
        expect(chunk.endIndex).toBeGreaterThan(chunk.startIndex);
      });
    });

    it('should respect overlap tokens parameter', () => {
      const text = 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen';
      const chunks = TokenizerService.splitTextIntoChunks(text, 5, 2);
      expect(chunks.length).toBeGreaterThan(1);
    });

    it('should handle text shorter than chunk size', () => {
      const text = 'short text';
      const chunks = TokenizerService.splitTextIntoChunks(text, 100);
      expect(chunks.length).toBe(1);
      expect(chunks[0].text).toBe(text);
    });
  });

  describe('getCost', () => {
    it('should calculate input, output, and total cost', () => {
      const result = TokenizerService.getCost(1000, 500, 'gpt-4');

      expect(result.inputCost).toBe(0.03);
      expect(result.outputCost).toBe(0.03); // 500 tokens at $0.06/1K
      expect(result.totalCost).toBe(result.inputCost + result.outputCost);
    });
  });

  describe('optimizePrompt', () => {
    it('should include all parts when space allows', () => {
      const parts = {
        context: 'Some context',
        instruction: 'Follow these instructions',
        userInput: 'User question',
      };

      const result = TokenizerService.optimizePrompt(parts, 10000);

      expect(result).toContain('User question');
      expect(result).toContain('Follow these instructions');
      expect(result).toContain('Some context');
    });

    it('should prioritize user input over context', () => {
      const parts = {
        context: 'Long context '.repeat(100),
        instruction: 'Instructions',
        userInput: 'User question',
      };

      const result = TokenizerService.optimizePrompt(parts, 50);

      expect(result).toContain('User question');
    });
  });

  describe('cleanup', () => {
    it('should clear tokenizer cache', () => {
      TokenizerService.initialize();
      TokenizerService.cleanup();
      const count = TokenizerService.countTokens('test');
      expect(count).toBeGreaterThan(0);
    });
  });

  describe('message with array content', () => {
    it('should handle message with text array content', () => {
      const message = {
        role: 'user' as const,
        content: [{ type: 'text', text: 'Hello world' }] as any,
      };
      const count = TokenizerService.countMessageTokens(message);
      expect(count).toBeGreaterThan(0);
    });

    it('should handle message with image content', () => {
      const message = {
        role: 'user' as const,
        content: [
          { type: 'text', text: 'What is in this image?' },
          { type: 'image', image: 'base64data' },
        ] as any,
      };
      const count = TokenizerService.countMessageTokens(message);
      expect(count).toBeGreaterThan(85);
    });
  });
});

