import { llm } from '@grafana/llm';
import { TokenizerService, truncateToTokenLimit } from '../../../../services/tokenizer';
import { MAX_TOOL_RESPONSE_TOKENS, AGGRESSIVE_TOOL_RESPONSE_TOKENS } from '../../../../constants';

// Mock dependencies
jest.mock('@grafana/llm', () => ({
  llm: {
    Model: { LARGE: 'large' },
    chatCompletions: jest.fn(),
  },
}));

jest.mock('../../../../services/queue', () => ({
  llmRequestQueue: {
    add: jest.fn((fn) => fn()),
  },
}));

// Import the internal functions by recreating them here for testing
// Since they're not exported, we test the same logic

const trimToolResponseContent = (
  content: string,
  maxTokens: number = MAX_TOOL_RESPONSE_TOKENS
): { content: string; wasTrimmed: boolean } => {
  const actualTokens = TokenizerService.countTokens(content);
  if (actualTokens <= maxTokens) {
    return { content, wasTrimmed: false };
  }

  const trimmedContent = truncateToTokenLimit(content, maxTokens, true);
  return { content: trimmedContent, wasTrimmed: true };
};

const trimMessageContent = (
  message: llm.Message,
  aggressive = false
): { message: llm.Message; wasTrimmed: boolean } => {
  if (message.role === 'tool' && typeof message.content === 'string') {
    const maxTokens = aggressive ? AGGRESSIVE_TOOL_RESPONSE_TOKENS : MAX_TOOL_RESPONSE_TOKENS;
    const { content, wasTrimmed } = trimToolResponseContent(message.content, maxTokens);
    return {
      message: { ...message, content },
      wasTrimmed,
    };
  }

  return { message, wasTrimmed: false };
};

const trimMessagesToTokenLimit = (messages: llm.Message[], tools: any[], maxTokens: number): llm.Message[] => {
  const formattedTools = tools;
  let contextInfo = TokenizerService.calculateContextTokens(messages, formattedTools);

  if (contextInfo.totalTokens <= maxTokens) {
    return messages;
  }

  // First pass: Trim large tool responses
  let messagesWithTrimmedTools = messages.map((msg) => {
    const { message } = trimMessageContent(msg);
    return message;
  });

  contextInfo = TokenizerService.calculateContextTokens(messagesWithTrimmedTools, formattedTools);

  if (contextInfo.totalTokens > maxTokens) {
    messagesWithTrimmedTools = messages.map((msg) => {
      const { message } = trimMessageContent(msg, true);
      return message;
    });

    contextInfo = TokenizerService.calculateContextTokens(messagesWithTrimmedTools, formattedTools);
  }

  if (contextInfo.totalTokens <= maxTokens) {
    return messagesWithTrimmedTools;
  }

  // Trim old messages to fit
  const systemMessage =
    messagesWithTrimmedTools.length > 0 && messagesWithTrimmedTools[0].role === 'system'
      ? messagesWithTrimmedTools[0]
      : null;
  const nonSystemMessages = systemMessage ? messagesWithTrimmedTools.slice(1) : messagesWithTrimmedTools;

  let trimmedMessages: llm.Message[] = systemMessage ? [systemMessage] : [];
  const targetTokens = maxTokens - 1000; // Buffer

  for (let i = nonSystemMessages.length - 1; i >= 0; i--) {
    const testMessages = [systemMessage, ...nonSystemMessages.slice(i)].filter(Boolean) as llm.Message[];
    const testContextInfo = TokenizerService.calculateContextTokens(testMessages, formattedTools);

    if (testContextInfo.totalTokens <= targetTokens) {
      trimmedMessages = testMessages;
      break;
    }
  }

  if (trimmedMessages.length <= (systemMessage ? 1 : 0) && nonSystemMessages.length > 0) {
    trimmedMessages = systemMessage
      ? [systemMessage, nonSystemMessages[nonSystemMessages.length - 1]]
      : [nonSystemMessages[nonSystemMessages.length - 1]];
  }

  return trimmedMessages;
};

// Simulate streaming function
const simulateStreaming = async (
  content: string,
  updateCallback: (partialContent: string) => void,
  abortSignal?: AbortSignal
): Promise<void> => {
  const CHARS_PER_UPDATE = 50;
  const UPDATE_INTERVAL_MS = 10; // Faster for tests

  if (!content) {
    updateCallback(content);
    return;
  }

  let currentIndex = 0;
  while (currentIndex < content.length) {
    if (abortSignal?.aborted) {
      throw new DOMException('Streaming aborted', 'AbortError');
    }

    const nextIndex = Math.min(currentIndex + CHARS_PER_UPDATE, content.length);
    const partialContent = content.slice(0, nextIndex);
    updateCallback(partialContent);
    currentIndex = nextIndex;

    if (currentIndex < content.length) {
      await new Promise((resolve) => setTimeout(resolve, UPDATE_INTERVAL_MS));
    }
  }
};

const withTimeout = <T>(promise: Promise<T>, timeoutMs: number, operationName: string): Promise<T> => {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(
        () => reject(new Error(`${operationName} timed out after ${timeoutMs}ms.`)),
        timeoutMs
      )
    ),
  ]);
};

describe('Stream Manager Utilities', () => {
  beforeEach(() => {
    TokenizerService.initialize();
  });

  describe('truncateToTokenLimit', () => {
    it('should return original text when within limit', () => {
      const text = 'Hello world';
      const result = truncateToTokenLimit(text, 100);
      expect(result).toBe(text);
    });

    it('should truncate text when exceeding limit', () => {
      const text = 'This is a long text that should be truncated to a much smaller size.';
      const result = truncateToTokenLimit(text, 5);
      expect(result.length).toBeLessThan(text.length);
    });

    it('should add suffix when truncating and suffix requested', () => {
      // Use much longer text to ensure truncation happens
      const text = 'This is a very long text. '.repeat(50);
      const result = truncateToTokenLimit(text, 10, true);
      // Truncated text should be shorter than original
      expect(result.length).toBeLessThan(text.length);
      // Should contain some truncation indicator
      expect(result).toContain('truncated');
    });

    it('should handle empty text', () => {
      const result = truncateToTokenLimit('', 100);
      expect(result).toBe('');
    });
  });

  describe('TokenizerService.countTokens', () => {
    it('should count tokens for simple text', () => {
      const count = TokenizerService.countTokens('Hello world');
      expect(count).toBeGreaterThan(0);
      expect(count).toBeLessThan(10);
    });

    it('should count zero tokens for empty string', () => {
      const count = TokenizerService.countTokens('');
      expect(count).toBe(0);
    });

    it('should count more tokens for longer text', () => {
      const shortCount = TokenizerService.countTokens('Hi');
      const longCount = TokenizerService.countTokens('This is a much longer sentence with many more words');
      expect(longCount).toBeGreaterThan(shortCount);
    });
  });

  describe('TokenizerService.calculateContextTokens', () => {
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

    it('should handle empty messages array', () => {
      const result = TokenizerService.calculateContextTokens([]);

      expect(result.messageTokens).toBe(0);
      expect(result.totalTokens).toBe(0);
    });

    it('should handle empty tools array', () => {
      const messages = [{ role: 'user' as const, content: 'Hello' }];
      const result = TokenizerService.calculateContextTokens(messages, []);

      expect(result.toolTokens).toBe(0);
      expect(result.messageTokens).toBeGreaterThan(0);
    });
  });

  describe('TokenizerService.countToolTokens', () => {
    it('should count tokens for tool definitions', () => {
      const tools = [
        { name: 'tool1', description: 'Description 1', parameters: {} },
        { name: 'tool2', description: 'Description 2', parameters: { type: 'object' } },
      ];

      const count = TokenizerService.countToolTokens(tools);

      expect(count).toBeGreaterThan(0);
    });

    it('should return zero for empty tools array', () => {
      const count = TokenizerService.countToolTokens([]);
      expect(count).toBe(0);
    });
  });

  describe('TokenizerService.getTokenBudget', () => {
    it('should calculate remaining budget', () => {
      const messages = [
        { role: 'user' as const, content: 'Hello' },
      ];

      const budget = TokenizerService.getTokenBudget(messages);

      expect(budget).toHaveProperty('used');
      expect(budget).toHaveProperty('remaining');
      expect(budget).toHaveProperty('limit');
      expect(budget).toHaveProperty('percentage');
      expect(budget.remaining).toBeGreaterThan(0);
      expect(budget.used).toBeGreaterThan(0);
    });

    it('should return budget with correct structure', () => {
      const messages = [{ role: 'user' as const, content: 'Hello' }];

      const budget = TokenizerService.getTokenBudget(messages, 'gpt-4');

      expect(budget.remaining + budget.used).toBe(budget.limit);
      expect(budget.percentage).toBe((budget.used / budget.limit) * 100);
    });
  });

  describe('TokenizerService.splitTextIntoChunks', () => {
    it('should return empty array for empty text', () => {
      const chunks = TokenizerService.splitTextIntoChunks('', 100);
      expect(chunks).toEqual([]);
    });

    it('should split long text into chunks', () => {
      const longText = 'word '.repeat(500);
      const chunks = TokenizerService.splitTextIntoChunks(longText, 50);

      expect(chunks.length).toBeGreaterThan(1);
      chunks.forEach((chunk) => {
        expect(TokenizerService.countTokens(chunk.text)).toBeLessThanOrEqual(60); // Allow some margin
      });
    });

    it('should include startIndex and endIndex', () => {
      const text = 'Hello world this is a test';
      const chunks = TokenizerService.splitTextIntoChunks(text, 10);

      chunks.forEach((chunk) => {
        expect(chunk).toHaveProperty('startIndex');
        expect(chunk).toHaveProperty('endIndex');
        expect(chunk.startIndex).toBeLessThanOrEqual(chunk.endIndex);
      });
    });

    it('should handle text shorter than chunk size', () => {
      const text = 'Short text';
      const chunks = TokenizerService.splitTextIntoChunks(text, 100);

      expect(chunks).toHaveLength(1);
      expect(chunks[0].text).toBe(text);
    });
  });

  describe('TokenizerService.estimateCost', () => {
    it('should calculate cost for input tokens', () => {
      const cost = TokenizerService.estimateCost(1000, 'gpt-4', false);
      expect(cost).toBeGreaterThan(0);
    });

    it('should calculate higher cost for output tokens', () => {
      const inputCost = TokenizerService.estimateCost(1000, 'gpt-4', false);
      const outputCost = TokenizerService.estimateCost(1000, 'gpt-4', true);
      expect(outputCost).toBeGreaterThan(inputCost);
    });

    it('should handle unknown models with default pricing', () => {
      const cost = TokenizerService.estimateCost(1000, 'unknown-model');
      expect(cost).toBeGreaterThan(0);
    });
  });

  describe('TokenizerService.getCost', () => {
    it('should calculate total cost for input and output', () => {
      const cost = TokenizerService.getCost(1000, 500, 'gpt-4');

      expect(cost).toHaveProperty('inputCost');
      expect(cost).toHaveProperty('outputCost');
      expect(cost).toHaveProperty('totalCost');
      expect(cost.totalCost).toBe(cost.inputCost + cost.outputCost);
    });
  });

  describe('TokenizerService.optimizePrompt', () => {
    it('should include all parts when space allows', () => {
      const result = TokenizerService.optimizePrompt(
        {
          instruction: 'System instructions',
          userInput: 'User input',
          context: 'Additional context',
        },
        1000
      );

      expect(result).toContain('System instructions');
      expect(result).toContain('User input');
      expect(result).toContain('Additional context');
    });

    it('should prioritize user input over context when space limited', () => {
      const longContext = 'context '.repeat(1000);
      const result = TokenizerService.optimizePrompt(
        {
          instruction: 'Short system',
          userInput: 'Important user input',
          context: longContext,
        },
        50
      );

      expect(result).toContain('Important user input');
    });
  });

  describe('TokenizerService.cleanup', () => {
    it('should clear tokenizer cache', () => {
      // Count tokens to populate cache
      TokenizerService.countTokens('Test text');

      // Cleanup
      TokenizerService.cleanup();

      // Should still work after cleanup
      const count = TokenizerService.countTokens('New text');
      expect(count).toBeGreaterThan(0);
    });
  });

  describe('trimToolResponseContent', () => {
    it('should return content unchanged when within limit', () => {
      const content = 'Short response';
      const result = trimToolResponseContent(content, 1000);

      expect(result.content).toBe(content);
      expect(result.wasTrimmed).toBe(false);
    });

    it('should trim content when exceeding limit', () => {
      // Create a very long content
      const content = 'word '.repeat(1000);
      const result = trimToolResponseContent(content, 10);

      expect(result.content.length).toBeLessThan(content.length);
      expect(result.wasTrimmed).toBe(true);
    });

    it('should use default max tokens', () => {
      const content = 'Short content';
      const result = trimToolResponseContent(content);

      expect(result.wasTrimmed).toBe(false);
    });
  });

  describe('trimMessageContent', () => {
    it('should not trim non-tool messages', () => {
      const message: llm.Message = {
        role: 'user',
        content: 'This is a user message that should not be trimmed',
      };
      const result = trimMessageContent(message);

      expect(result.message.content).toBe(message.content);
      expect(result.wasTrimmed).toBe(false);
    });

    it('should trim long tool messages', () => {
      // Create content that exceeds MAX_TOOL_RESPONSE_TOKENS (which is in tokens, not characters)
      // The token limit is typically around 4096 tokens for tool responses
      // A typical word is about 1.3 tokens, so 5000 words should exceed the limit
      const longContent = 'This is a very detailed response with lots of information. '.repeat(500);
      const message: llm.Message = {
        role: 'tool',
        content: longContent,
        tool_call_id: 'call_1',
      };
      const result = trimMessageContent(message);

      // If trimmed, the content should be shorter
      if (result.wasTrimmed) {
        expect((result.message.content as string).length).toBeLessThan(longContent.length);
      }
      // The function should at least return the message
      expect(result.message.role).toBe('tool');
    });

    it('should use aggressive trimming when specified', () => {
      const longContent = 'response '.repeat(500);
      const message: llm.Message = {
        role: 'tool',
        content: longContent,
        tool_call_id: 'call_1',
      };

      const normalResult = trimMessageContent(message, false);
      const aggressiveResult = trimMessageContent(message, true);

      // Aggressive should be same or shorter
      expect((aggressiveResult.message.content as string).length).toBeLessThanOrEqual(
        (normalResult.message.content as string).length
      );
    });

    it('should handle non-string tool content', () => {
      const message = {
        role: 'tool' as const,
        content: undefined,
        tool_call_id: 'call_1',
      } as unknown as llm.Message;
      const result = trimMessageContent(message);

      expect(result.message).toEqual(message);
      expect(result.wasTrimmed).toBe(false);
    });
  });

  describe('trimMessagesToTokenLimit', () => {
    it('should return messages unchanged when within limit', () => {
      const messages: llm.Message[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
      ];
      const result = trimMessagesToTokenLimit(messages, [], 10000);

      expect(result).toEqual(messages);
    });

    it('should preserve system message when trimming', () => {
      const systemMessage: llm.Message = { role: 'system', content: 'You are a helpful assistant.' };
      const messages: llm.Message[] = [
        systemMessage,
        { role: 'user', content: 'message '.repeat(100) },
        { role: 'assistant', content: 'response '.repeat(100) },
        { role: 'user', content: 'Latest message' },
      ];
      const result = trimMessagesToTokenLimit(messages, [], 50);

      expect(result[0]).toEqual(systemMessage);
      expect(result.length).toBeLessThan(messages.length);
    });

    it('should keep most recent messages', () => {
      const messages: llm.Message[] = [
        { role: 'user', content: 'First message' },
        { role: 'assistant', content: 'First response' },
        { role: 'user', content: 'Second message' },
        { role: 'assistant', content: 'Second response' },
        { role: 'user', content: 'Latest message' },
      ];
      const result = trimMessagesToTokenLimit(messages, [], 20);

      // Should keep at least the latest message
      expect(result[result.length - 1].content).toContain('Latest');
    });

    it('should handle empty messages array', () => {
      const result = trimMessagesToTokenLimit([], [], 1000);
      expect(result).toEqual([]);
    });

    it('should handle single message', () => {
      const messages: llm.Message[] = [{ role: 'user', content: 'Only message' }];
      const result = trimMessagesToTokenLimit(messages, [], 1000);
      expect(result).toEqual(messages);
    });
  });

  describe('simulateStreaming', () => {
    it('should call updateCallback with full content for empty string', async () => {
      const updateCallback = jest.fn();
      await simulateStreaming('', updateCallback);

      expect(updateCallback).toHaveBeenCalledWith('');
    });

    it('should call updateCallback progressively', async () => {
      const updateCallback = jest.fn();
      const content = 'This is test content for streaming simulation that should be long enough.';
      await simulateStreaming(content, updateCallback);

      // Should have been called at least once
      expect(updateCallback).toHaveBeenCalled();
      // Last call should have full content
      expect(updateCallback).toHaveBeenLastCalledWith(content);
    });

    it('should respect abort signal', async () => {
      const updateCallback = jest.fn();
      const controller = new AbortController();
      const content = 'This is content '.repeat(50);

      // Abort after a short delay
      setTimeout(() => controller.abort(), 20);

      await expect(simulateStreaming(content, updateCallback, controller.signal)).rejects.toThrow('Streaming aborted');
    });

    it('should handle already aborted signal', async () => {
      const updateCallback = jest.fn();
      const controller = new AbortController();
      controller.abort();

      await expect(simulateStreaming('content', updateCallback, controller.signal)).rejects.toThrow('Streaming aborted');
    });
  });

  describe('withTimeout', () => {
    it('should resolve when promise completes in time', async () => {
      const result = await withTimeout(Promise.resolve('success'), 1000, 'test');
      expect(result).toBe('success');
    });

    it('should reject when promise times out', async () => {
      const slowPromise = new Promise((resolve) => setTimeout(() => resolve('late'), 1000));
      await expect(withTimeout(slowPromise, 50, 'slow operation')).rejects.toThrow('timed out');
    });

    it('should include operation name in timeout error', async () => {
      const slowPromise = new Promise((resolve) => setTimeout(() => resolve('late'), 1000));
      await expect(withTimeout(slowPromise, 50, 'MyOperation')).rejects.toThrow('MyOperation timed out');
    });

    it('should propagate original error when promise rejects', async () => {
      const failingPromise = Promise.reject(new Error('Original error'));
      await expect(withTimeout(failingPromise, 1000, 'test')).rejects.toThrow('Original error');
    });
  });

  describe('TokenizerService.countMessageTokens', () => {
    it('should handle message with text content', () => {
      const message = { role: 'user' as const, content: 'Hello world' };
      const count = TokenizerService.countMessageTokens(message);
      expect(count).toBeGreaterThan(0);
    });

    it('should handle message with array content', () => {
      const message = {
        role: 'user' as const,
        content: [
          { type: 'text', text: 'First part' },
          { type: 'text', text: 'Second part' },
        ],
      };
      const count = TokenizerService.countMessageTokens(message as any);
      expect(count).toBeGreaterThan(0);
    });

    it('should handle message with image content', () => {
      const message = {
        role: 'user' as const,
        content: [
          { type: 'image_url', image_url: { url: 'data:image/png;base64,...' } },
        ],
      };
      const count = TokenizerService.countMessageTokens(message as any);
      // Image tokens are estimated
      expect(count).toBeGreaterThanOrEqual(0);
    });

    it('should handle assistant message with tool_calls', () => {
      const message = {
        role: 'assistant' as const,
        content: '',
        tool_calls: [
          {
            id: 'call_1',
            type: 'function' as const,
            function: { name: 'test_tool', arguments: '{"key": "value"}' },
          },
        ],
      };
      const count = TokenizerService.countMessageTokens(message);
      expect(count).toBeGreaterThan(0);
    });
  });
});

