import { llm } from '@grafana/llm';
import { lastValueFrom } from 'rxjs';
import { ChatMessage } from '../components/Chat/types';

/**
 * Memory service for conversation summarization and context management
 */
export class ConversationMemoryService {
  /**
   * Summarize a set of messages to preserve context while reducing tokens
   */
  static async summarizeMessages(messages: ChatMessage[]): Promise<string> {
    if (messages.length === 0) {
      return '';
    }

    // Create a summary prompt
    const conversationText = messages
      .map((msg) => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`)
      .join('\n\n');

    const summaryPrompt = `Please provide a concise summary of the following conversation between a user and an AI assistant. Focus on:
1. Key questions asked by the user
2. Important information discovered or tools used
3. Main conclusions or action items
4. Any ongoing context that should be remembered

Conversation:
${conversationText}

Summary:`;

    try {
      // Use streaming API and accumulate the result
      const stream = llm.streamChatCompletions({
        model: llm.Model.LARGE, // Use available model
        messages: [{ role: 'user', content: summaryPrompt }],
      });

      // Accumulate the full response
      const result = await lastValueFrom(stream.pipe(llm.accumulateContent()));

      return typeof result === 'string' ? result : '';
    } catch (error) {
      console.error('Failed to generate summary:', error);
      return this.fallbackSummarize(messages);
    }
  }

  /**
   * Fallback summarization without LLM (simple extraction)
   */
  private static fallbackSummarize(messages: ChatMessage[]): string {
    const userMessages = messages.filter((msg) => msg.role === 'user');
    const topics = userMessages.map((msg, idx) => `${idx + 1}. ${msg.content.slice(0, 100)}...`);

    return `Conversation covered ${messages.length} messages about:\n${topics.join('\n')}`;
  }

  /**
   * Create a memory-aware message history for context
   * Combines recent messages with older summaries
   */
  static createMemoryAwareHistory(
    allMessages: ChatMessage[],
    summary?: string,
    recentMessageCount = 10
  ): { summary: string | null; recentMessages: ChatMessage[] } {
    // If we have fewer messages than the threshold, return all
    if (allMessages.length <= recentMessageCount) {
      return { summary: null, recentMessages: allMessages };
    }

    // Split into old (to be summarized) and recent (keep full)
    const recentMessages = allMessages.slice(-recentMessageCount);

    return {
      summary: summary || null,
      recentMessages,
    };
  }

  /**
   * Generate a context summary message to inject into conversation
   */
  static createContextSummaryMessage(summary: string): llm.Message {
    return {
      role: 'system',
      content: `[Previous conversation summary: ${summary}]`,
    };
  }

  /**
   * Determine if a conversation should be summarized
   */
  static shouldSummarize(messageCount: number, threshold = 20): boolean {
    return messageCount >= threshold && messageCount % 10 === 0; // Summarize every 10 messages after threshold
  }

  /**
   * Extract key information from tool calls for memory
   */
  static extractToolCallContext(messages: ChatMessage[]): string[] {
    const toolContext: string[] = [];

    messages.forEach((msg) => {
      if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
        msg.toolCalls.forEach((tc) => {
          if (!tc.error) {
            toolContext.push(`Used tool: ${tc.name}`);
          }
        });
      }
    });

    return toolContext;
  }

  /**
   * Create a smart context window that includes:
   * - System prompt
   * - Conversation summary (if available)
   * - Recent messages
   * - Current user message
   */
  static buildContextWindow(
    systemPrompt: string,
    allMessages: ChatMessage[],
    summary?: string,
    recentMessageCount = 10
  ): llm.Message[] {
    const context: llm.Message[] = [];

    // 1. System prompt
    context.push({ role: 'system', content: systemPrompt });

    // 2. Add summary if available and conversation is long
    if (summary && allMessages.length > recentMessageCount) {
      context.push(this.createContextSummaryMessage(summary));
    }

    // 3. Add recent messages
    const recentMessages = allMessages.slice(-recentMessageCount);
    recentMessages.forEach((msg) => {
      context.push({ role: msg.role, content: msg.content });
    });

    return context;
  }

  /**
   * Estimate if current context will fit in token limit
   */
  static estimateContextSize(messages: llm.Message[], tools: any[]): number {
    let totalTokens = 0;

    messages.forEach((msg) => {
      const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
      totalTokens += Math.ceil(content.length / 4); // ~4 chars per token
    });

    tools.forEach((tool) => {
      totalTokens += Math.ceil(JSON.stringify(tool).length / 4);
    });

    return totalTokens;
  }

  /**
   * Optimize message history for token efficiency
   */
  static optimizeMessageHistory(
    messages: ChatMessage[],
    maxTokens = 50000,
    summary?: string
  ): { messages: ChatMessage[]; needsSummary: boolean } {
    const estimatedTokens = messages.reduce((total, msg) => {
      return total + Math.ceil(msg.content.length / 4);
    }, 0);

    // If within limit, no optimization needed
    if (estimatedTokens < maxTokens * 0.7) {
      // 70% threshold
      return { messages, needsSummary: false };
    }

    // If we have a summary, keep fewer old messages
    const recentCount = summary ? 15 : 25;

    // Check if we need to generate a new summary
    const needsSummary = !summary && messages.length > 30;

    return {
      messages: messages.slice(-recentCount),
      needsSummary,
    };
  }
}
