import { ConversationMemoryService } from '../memory';
import { ChatMessage } from '../../components/Chat/types';
import { llm } from '@grafana/llm';
import { of, throwError } from 'rxjs';

// Mock the @grafana/llm module
jest.mock('@grafana/llm', () => ({
  llm: {
    Model: { LARGE: 'large' },
    streamChatCompletions: jest.fn(),
    accumulateContent: jest.fn(),
  },
}));

describe('ConversationMemoryService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('summarizeMessages', () => {
    it('should return empty string for empty messages', async () => {
      const result = await ConversationMemoryService.summarizeMessages([]);

      expect(result).toBe('');
    });

    it('should call LLM to summarize messages', async () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'What is Prometheus?' },
        { role: 'assistant', content: 'Prometheus is a monitoring system.' },
      ];

      // Mock the streaming API
      const mockAccumulator = () => of('Summary of the conversation');
      (llm.streamChatCompletions as jest.Mock).mockReturnValue({
        pipe: jest.fn().mockReturnValue(of('Summary of the conversation')),
      });
      (llm.accumulateContent as jest.Mock).mockReturnValue(mockAccumulator);

      const result = await ConversationMemoryService.summarizeMessages(messages);

      expect(llm.streamChatCompletions).toHaveBeenCalled();
      expect(result).toBe('Summary of the conversation');
    });

    it('should use fallback summarization when LLM fails', async () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'What is Prometheus?' },
        { role: 'assistant', content: 'Prometheus is a monitoring system.' },
      ];

      // Mock the streaming API to fail
      (llm.streamChatCompletions as jest.Mock).mockReturnValue({
        pipe: jest.fn().mockReturnValue(throwError(() => new Error('LLM failed'))),
      });
      (llm.accumulateContent as jest.Mock).mockReturnValue(() => throwError(() => new Error('LLM failed')));

      const result = await ConversationMemoryService.summarizeMessages(messages);

      // Should use fallback which includes message count
      expect(result).toContain('2 messages');
    });

    it('should return empty string for non-string LLM response', async () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'Test message' },
      ];

      // Mock the streaming API to return non-string
      (llm.streamChatCompletions as jest.Mock).mockReturnValue({
        pipe: jest.fn().mockReturnValue(of({ invalidObject: true })),
      });
      (llm.accumulateContent as jest.Mock).mockReturnValue(() => of({ invalidObject: true }));

      const result = await ConversationMemoryService.summarizeMessages(messages);

      expect(result).toBe('');
    });

    it('should format conversation text correctly in summary prompt', async () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
      ];

      (llm.streamChatCompletions as jest.Mock).mockReturnValue({
        pipe: jest.fn().mockReturnValue(of('Test summary')),
      });
      (llm.accumulateContent as jest.Mock).mockReturnValue(() => of('Test summary'));

      await ConversationMemoryService.summarizeMessages(messages);

      // Check that the prompt was formatted correctly
      expect(llm.streamChatCompletions).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              content: expect.stringContaining('User: Hello'),
            }),
          ]),
        })
      );
    });
  });


  describe('createMemoryAwareHistory', () => {
    it('should return all messages when below threshold', () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
      ];

      const result = ConversationMemoryService.createMemoryAwareHistory(messages);

      expect(result.summary).toBeNull();
      expect(result.recentMessages).toEqual(messages);
    });

    it('should split messages when above threshold', () => {
      const messages: ChatMessage[] = Array.from({ length: 15 }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Message ${i}`,
      }));

      const result = ConversationMemoryService.createMemoryAwareHistory(messages);

      expect(result.recentMessages).toHaveLength(10);
      expect(result.recentMessages[0].content).toBe('Message 5');
    });

    it('should use custom recent message count', () => {
      const messages: ChatMessage[] = Array.from({ length: 20 }, (_, i) => ({
        role: 'user',
        content: `Message ${i}`,
      }));

      const result = ConversationMemoryService.createMemoryAwareHistory(messages, undefined, 5);

      expect(result.recentMessages).toHaveLength(5);
    });

    it('should include provided summary', () => {
      const messages: ChatMessage[] = Array.from({ length: 15 }, (_, i) => ({
        role: 'user',
        content: `Message ${i}`,
      }));

      const result = ConversationMemoryService.createMemoryAwareHistory(messages, 'Previous summary');

      expect(result.summary).toBe('Previous summary');
    });
  });

  describe('createContextSummaryMessage', () => {
    it('should create a system message with summary', () => {
      const summary = 'User asked about Prometheus metrics';

      const message = ConversationMemoryService.createContextSummaryMessage(summary);

      expect(message.role).toBe('system');
      expect(message.content).toContain(summary);
      expect(message.content).toContain('Previous conversation summary');
    });
  });

  describe('shouldSummarize', () => {
    it('should return false below threshold', () => {
      expect(ConversationMemoryService.shouldSummarize(10)).toBe(false);
      expect(ConversationMemoryService.shouldSummarize(19)).toBe(false);
    });

    it('should return true at threshold multiples', () => {
      expect(ConversationMemoryService.shouldSummarize(20)).toBe(true);
      expect(ConversationMemoryService.shouldSummarize(30)).toBe(true);
      expect(ConversationMemoryService.shouldSummarize(40)).toBe(true);
    });

    it('should return false at non-multiples above threshold', () => {
      expect(ConversationMemoryService.shouldSummarize(21)).toBe(false);
      expect(ConversationMemoryService.shouldSummarize(25)).toBe(false);
    });

    it('should use custom threshold', () => {
      expect(ConversationMemoryService.shouldSummarize(10, 10)).toBe(true);
      expect(ConversationMemoryService.shouldSummarize(10, 15)).toBe(false);
    });
  });

  describe('extractToolCallContext', () => {
    it('should return empty array for messages without tool calls', () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi!' },
      ];

      const result = ConversationMemoryService.extractToolCallContext(messages);

      expect(result).toEqual([]);
    });

    it('should extract successful tool calls', () => {
      const messages: ChatMessage[] = [
        {
          role: 'assistant',
          content: 'Let me query that',
          toolCalls: [{ name: 'prometheus_query', arguments: '{}', running: false }],
        },
      ];

      const result = ConversationMemoryService.extractToolCallContext(messages);

      expect(result).toHaveLength(1);
      expect(result[0]).toContain('prometheus_query');
    });

    it('should skip failed tool calls', () => {
      const messages: ChatMessage[] = [
        {
          role: 'assistant',
          content: 'Error occurred',
          toolCalls: [{ name: 'failing_tool', arguments: '{}', running: false, error: 'Failed' }],
        },
      ];

      const result = ConversationMemoryService.extractToolCallContext(messages);

      expect(result).toEqual([]);
    });

    it('should extract multiple tool calls from multiple messages', () => {
      const messages: ChatMessage[] = [
        {
          role: 'assistant',
          content: 'First query',
          toolCalls: [{ name: 'tool1', arguments: '{}', running: false }],
        },
        { role: 'user', content: 'Continue' },
        {
          role: 'assistant',
          content: 'Second query',
          toolCalls: [
            { name: 'tool2', arguments: '{}', running: false },
            { name: 'tool3', arguments: '{}', running: false },
          ],
        },
      ];

      const result = ConversationMemoryService.extractToolCallContext(messages);

      expect(result).toHaveLength(3);
    });
  });

  describe('buildContextWindow', () => {
    it('should include system prompt', () => {
      const messages: ChatMessage[] = [];

      const result = ConversationMemoryService.buildContextWindow('You are a helpful assistant', messages);

      expect(result).toHaveLength(1);
      expect(result[0].role).toBe('system');
      expect(result[0].content).toBe('You are a helpful assistant');
    });

    it('should include recent messages', () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi!' },
      ];

      const result = ConversationMemoryService.buildContextWindow('System prompt', messages);

      expect(result).toHaveLength(3);
      expect(result[1].content).toBe('Hello');
      expect(result[2].content).toBe('Hi!');
    });

    it('should include summary when conversation is long', () => {
      const messages: ChatMessage[] = Array.from({ length: 15 }, (_, i) => ({
        role: 'user',
        content: `Message ${i}`,
      }));

      const result = ConversationMemoryService.buildContextWindow('System', messages, 'Summary of old messages');

      expect(result.length).toBeGreaterThan(11); // system + summary + recent
      expect(result[1].content).toContain('Summary of old messages');
    });

    it('should not include summary when conversation is short', () => {
      const messages: ChatMessage[] = [{ role: 'user', content: 'Hello' }];

      const result = ConversationMemoryService.buildContextWindow('System', messages, 'Summary');

      expect(result).toHaveLength(2); // system + 1 message, no summary
    });
  });

  describe('estimateContextSize', () => {
    it('should estimate tokens for messages', () => {
      const messages = [
        { role: 'user' as const, content: 'Hello world' }, // 11 chars -> ~3 tokens
        { role: 'assistant' as const, content: 'Hi there!' }, // 9 chars -> ~3 tokens
      ];

      const result = ConversationMemoryService.estimateContextSize(messages, []);

      expect(result).toBeGreaterThan(0);
      expect(result).toBeLessThan(20); // Reasonable estimate
    });

    it('should include tool definitions in estimate', () => {
      const messages = [{ role: 'user' as const, content: 'Hello' }];
      const tools = [{ name: 'test_tool', description: 'A test tool with description' }];

      const result = ConversationMemoryService.estimateContextSize(messages, tools);

      expect(result).toBeGreaterThan(5); // Includes tool overhead
    });

    it('should handle empty inputs', () => {
      const result = ConversationMemoryService.estimateContextSize([], []);
      expect(result).toBe(0);
    });
  });

  describe('optimizeMessageHistory', () => {
    it('should return all messages when within limit', () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'Short message' },
        { role: 'assistant', content: 'Short reply' },
      ];

      const result = ConversationMemoryService.optimizeMessageHistory(messages);

      expect(result.messages).toEqual(messages);
      expect(result.needsSummary).toBe(false);
    });

    it('should truncate messages when over limit', () => {
      // Create messages that exceed token limit
      const longContent = 'x'.repeat(10000); // ~2500 tokens each
      const messages: ChatMessage[] = Array.from({ length: 30 }, () => ({
        role: 'user',
        content: longContent,
      }));

      const result = ConversationMemoryService.optimizeMessageHistory(messages, 50000);

      expect(result.messages.length).toBeLessThan(30);
    });

    it('should indicate need for summary when no summary provided and many messages', () => {
      const longContent = 'x'.repeat(10000);
      const messages: ChatMessage[] = Array.from({ length: 35 }, () => ({
        role: 'user',
        content: longContent,
      }));

      const result = ConversationMemoryService.optimizeMessageHistory(messages, 50000);

      expect(result.needsSummary).toBe(true);
    });

    it('should not need summary when summary already provided', () => {
      const longContent = 'x'.repeat(10000);
      const messages: ChatMessage[] = Array.from({ length: 35 }, () => ({
        role: 'user',
        content: longContent,
      }));

      const result = ConversationMemoryService.optimizeMessageHistory(messages, 50000, 'Existing summary');

      expect(result.needsSummary).toBe(false);
    });

    it('should keep fewer messages when summary is available', () => {
      const longContent = 'x'.repeat(10000);
      const messages: ChatMessage[] = Array.from({ length: 35 }, () => ({
        role: 'user',
        content: longContent,
      }));

      const resultWithSummary = ConversationMemoryService.optimizeMessageHistory(messages, 50000, 'Summary');
      const resultWithoutSummary = ConversationMemoryService.optimizeMessageHistory(messages, 50000);

      expect(resultWithSummary.messages.length).toBeLessThan(resultWithoutSummary.messages.length);
    });
  });
});

