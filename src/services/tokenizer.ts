/**
 * Token counting service using tiktoken for accurate OpenAI model token estimation
 * Provides precise token counting for context window management and cost estimation
 */

import { Tiktoken, encodingForModel, TiktokenModel } from 'js-tiktoken';
import { llm } from '@grafana/llm';

// Type definition for chat messages
interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'function';
  content: string;
  name?: string;
}

// Cache for tokenizer instances to avoid re-creating them
const tokenizerCache = new Map<string, Tiktoken>();

/**
 * Get or create a tokenizer for the specified model
 * Caches tokenizers to improve performance
 */
function getTokenizer(model = 'gpt-4'): Tiktoken {
  if (tokenizerCache.has(model)) {
    return tokenizerCache.get(model)!;
  }

  try {
    // Try to get the encoding for the specific model
    const tokenizer = encodingForModel(model as TiktokenModel);
    tokenizerCache.set(model, tokenizer);
    return tokenizer;
  } catch (error) {
    // Fallback to GPT-4 encoding if model is not recognized
    const tokenizer = encodingForModel('gpt-4');
    tokenizerCache.set(model, tokenizer);
    return tokenizer;
  }
}

export class TokenizerService {
  private static tokenizer: Tiktoken | null = null;

  /**
   * Initialize the tokenizer with a specific model
   * @param model The model name (e.g., 'gpt-4', 'gpt-3.5-turbo')
   */
  static initialize(model = 'gpt-4') {
    this.tokenizer = getTokenizer(model);
  }

  /**
   * Count tokens in a text string
   * @param text The text to count tokens for
   * @returns The number of tokens
   */
  static countTokens(text: string): number {
    if (!this.tokenizer) {
      this.initialize();
    }

    if (!text) {
      return 0;
    }

    try {
      const tokens = this.tokenizer!.encode(text);
      return tokens.length;
    } catch (error) {
      console.error('[TokenizerService] Error counting tokens:', error);
      // Fallback to character-based estimation if tokenization fails
      return Math.ceil(text.length / 4);
    }
  }

  /**
   * Count tokens in a message object
   * Accounts for role, content, and tool calls
   * @param message The message object
   * @returns The number of tokens
   */
  static countMessageTokens(message: llm.Message): number {
    if (!this.tokenizer) {
      this.initialize();
    }

    let tokens = 0;

    // Every message follows <|start|>{role}\n{content}<|end|>\n
    // This adds approximately 4 tokens per message
    tokens += 4;

    // Count role tokens
    if (message.role) {
      tokens += this.countTokens(message.role);
    }

    // Count content tokens
    if (typeof message.content === 'string') {
      tokens += this.countTokens(message.content);
    } else if (message.content && Array.isArray(message.content)) {
      // Handle array content (multimodal messages)
      for (const part of message.content as any[]) {
        if (typeof part === 'string') {
          tokens += this.countTokens(part);
        } else if (part && typeof part === 'object') {
          if ('text' in part && part.text) {
            tokens += this.countTokens(part.text as string);
          }
          // Images and other non-text content have fixed token costs
          if ('image' in part) {
            // Base64 images typically use ~85 tokens per 512x512 tile
            tokens += 85; // Conservative estimate
          }
        }
      }
    }

    // Count tool call tokens
    if (message.tool_calls) {
      for (const toolCall of message.tool_calls) {
        // Tool call structure adds overhead
        tokens += 3; // For the tool call wrapper

        if ('function' in toolCall && toolCall.function) {
          tokens += this.countTokens(toolCall.function.name || '');
          tokens += this.countTokens(toolCall.function.arguments || '');
        } else {
          // Stringify the tool call for counting
          tokens += this.countTokens(JSON.stringify(toolCall));
        }
      }
    }

    // Count tool response tokens
    if (message.role === 'tool' && message.tool_call_id) {
      tokens += this.countTokens(message.tool_call_id);
    }

    return tokens;
  }

  /**
   * Count tokens for an array of messages
   * @param messages Array of messages
   * @returns Total number of tokens
   */
  static countMessagesTokens(messages: llm.Message[]): number {
    if (!messages || messages.length === 0) {
      return 0;
    }

    let totalTokens = 0;
    for (const message of messages) {
      totalTokens += this.countMessageTokens(message);
    }

    // Add tokens for message array wrapper
    totalTokens += 3;

    return totalTokens;
  }

  /**
   * Count tokens for tool definitions
   * @param tools Array of tool definitions
   * @returns Total number of tokens
   */
  static countToolTokens(tools: any[]): number {
    if (!tools || tools.length === 0) {
      return 0;
    }

    // Tools are typically sent as JSON, so we stringify them
    const toolsJson = JSON.stringify(tools);
    return this.countTokens(toolsJson);
  }

  /**
   * Calculate total context tokens including messages and tools
   * @param messages Array of messages
   * @param tools Array of tool definitions
   * @returns Object with detailed token counts
   */
  static calculateContextTokens(
    messages: llm.Message[],
    tools: any[] = []
  ): {
    messageTokens: number;
    toolTokens: number;
    totalTokens: number;
    breakdown: {
      system: number;
      user: number;
      assistant: number;
      tool: number;
    };
  } {
    const messageTokens = this.countMessagesTokens(messages);
    const toolTokens = this.countToolTokens(tools);

    // Calculate breakdown by role
    const breakdown = {
      system: 0,
      user: 0,
      assistant: 0,
      tool: 0,
    };

    for (const message of messages) {
      const tokens = this.countMessageTokens(message);
      switch (message.role) {
        case 'system':
          breakdown.system += tokens;
          break;
        case 'user':
          breakdown.user += tokens;
          break;
        case 'assistant':
          breakdown.assistant += tokens;
          break;
        case 'tool':
          breakdown.tool += tokens;
          break;
      }
    }

    return {
      messageTokens,
      toolTokens,
      totalTokens: messageTokens + toolTokens,
      breakdown,
    };
  }

  /**
   * Truncate text to fit within a token limit
   * @param text The text to truncate
   * @param maxTokens Maximum number of tokens
   * @param addEllipsis Whether to add ellipsis at the end
   * @returns Truncated text
   */
  static truncateToTokenLimit(text: string, maxTokens: number, addEllipsis = true): string {
    if (!this.tokenizer) {
      this.initialize();
    }

    if (!text) {
      return '';
    }

    try {
      const tokens = this.tokenizer!.encode(text);

      if (tokens.length <= maxTokens) {
        return text;
      }

      // Reserve tokens for ellipsis if needed
      const targetTokens = addEllipsis ? maxTokens - 5 : maxTokens;

      // Truncate tokens
      const truncatedTokens = tokens.slice(0, targetTokens);

      // Decode back to text
      let truncatedText = this.tokenizer!.decode(truncatedTokens);

      // Add ellipsis if requested
      if (addEllipsis) {
        truncatedText += '\n\n[... content truncated ...]';
      }

      return truncatedText;
    } catch (error) {
      console.error('[TokenizerService] Error truncating text:', error);
      // Fallback to character-based truncation
      const estimatedChars = maxTokens * 4;
      if (text.length <= estimatedChars) {
        return text;
      }

      const truncated = text.slice(0, estimatedChars - (addEllipsis ? 30 : 0));
      return addEllipsis ? truncated + '\n\n[... content truncated ...]' : truncated;
    }
  }

  /**
   * Estimate the cost of tokens based on model pricing
   * @param tokens Number of tokens
   * @param model Model name
   * @param isOutput Whether these are output tokens (more expensive)
   * @returns Estimated cost in USD
   */
  static estimateCost(tokens: number, model = 'gpt-4', isOutput = false): number {
    // Pricing as of 2024 (per 1K tokens)
    const pricing: Record<string, { input: number; output: number }> = {
      'gpt-4': { input: 0.03, output: 0.06 },
      'gpt-4-turbo': { input: 0.01, output: 0.03 },
      'gpt-3.5-turbo': { input: 0.0005, output: 0.0015 },
      'claude-3-opus': { input: 0.015, output: 0.075 },
      'claude-3-sonnet': { input: 0.003, output: 0.015 },
      'claude-3-haiku': { input: 0.00025, output: 0.00125 },
    };

    const modelPricing = pricing[model] || pricing['gpt-4'];
    const rate = isOutput ? modelPricing.output : modelPricing.input;

    return (tokens / 1000) * rate;
  }

  /**
   * Get token limit for a specific model
   * @param model Model name
   * @returns Maximum context window size in tokens
   */
  static getModelTokenLimit(model = 'gpt-4'): number {
    const limits: Record<string, number> = {
      'gpt-4': 8192,
      'gpt-4-32k': 32768,
      'gpt-4-turbo': 128000,
      'gpt-3.5-turbo': 16385,
      'gpt-3.5-turbo-16k': 16385,
      'claude-3-opus': 200000,
      'claude-3-sonnet': 200000,
      'claude-3-haiku': 200000,
    };

    return limits[model] || 8192;
  }

  /**
   * Validate if text is within token limit
   */
  static validateTokenLimit(text: string, limit: number): void {
    const tokens = this.countTokens(text);
    if (tokens > limit) {
      throw new Error(`Text exceeds token limit: ${tokens} tokens (limit: ${limit})`);
    }
  }

  /**
   * Estimate tokens (fallback method)
   */
  static estimateTokens(text: string): number {
    // Simple estimation: ~4 characters per token on average
    return Math.ceil(text.length / 4);
  }

  /**
   * Get token budget for messages
   */
  static getTokenBudget(
    messages: ChatMessage[],
    model = 'gpt-3.5-turbo'
  ): {
    used: number;
    remaining: number;
    limit: number;
    percentage: number;
  } {
    const limit = this.getModelTokenLimit(model);
    const used = this.countMessagesTokens(messages);
    const remaining = Math.max(0, limit - used);
    const percentage = (used / limit) * 100;

    return { used, remaining, limit, percentage };
  }

  /**
   * Split text into chunks with overlap
   */
  static splitTextIntoChunks(
    text: string,
    maxTokensPerChunk: number,
    overlapTokens = 0
  ): Array<{ text: string; startIndex: number; endIndex: number }> {
    if (!text) {
      return [];
    }

    const chunks: Array<{ text: string; startIndex: number; endIndex: number }> = [];
    const words = text.split(/\s+/);
    let currentChunk = '';
    let startIndex = 0;

    for (let i = 0; i < words.length; i++) {
      const testChunk = currentChunk ? `${currentChunk} ${words[i]}` : words[i];
      const tokenCount = this.countTokens(testChunk);

      if (tokenCount > maxTokensPerChunk) {
        if (currentChunk) {
          chunks.push({
            text: currentChunk,
            startIndex,
            endIndex: text.indexOf(currentChunk, startIndex) + currentChunk.length,
          });

          // Calculate overlap
          if (overlapTokens > 0 && chunks.length > 0) {
            const overlapWords = Math.ceil(overlapTokens * 0.75);
            i = Math.max(0, i - overlapWords);
          }

          startIndex = text.indexOf(words[i], startIndex + currentChunk.length);
          currentChunk = words[i];
        }
      } else {
        currentChunk = testChunk;
      }
    }

    if (currentChunk) {
      chunks.push({
        text: currentChunk,
        startIndex,
        endIndex: text.length,
      });
    }

    return chunks;
  }

  /**
   * Calculate cost for token usage
   */
  static getCost(
    inputTokens: number,
    outputTokens: number,
    model = 'gpt-3.5-turbo'
  ): {
    inputCost: number;
    outputCost: number;
    totalCost: number;
  } {
    // Use existing pricing
    const inputCost = this.estimateCost(inputTokens, model, false);
    const outputCost = this.estimateCost(outputTokens, model, true);

    return {
      inputCost,
      outputCost,
      totalCost: inputCost + outputCost,
    };
  }

  /**
   * Optimize prompt to fit within token limit
   */
  static optimizePrompt(
    parts: { context?: string; instruction: string; userInput: string },
    maxTokens: number
  ): string {
    // Prioritize: userInput > instruction > context
    const userTokens = this.countTokens(parts.userInput);
    const instructionTokens = this.countTokens(parts.instruction);

    let remainingTokens = maxTokens;
    let result = '';

    // Always include user input
    result = parts.userInput;
    remainingTokens -= userTokens;

    // Include instruction if space allows
    if (remainingTokens >= instructionTokens) {
      result = `${parts.instruction}\n\n${result}`;
      remainingTokens -= instructionTokens;
    }

    // Include as much context as possible
    if (parts.context && remainingTokens > 0) {
      const truncatedContext = this.truncateToTokenLimit(parts.context, remainingTokens - 10);
      result = `${truncatedContext}\n\n${result}`;
    }

    return result;
  }

  /**
   * Clean up resources
   */
  static cleanup() {
    if (this.tokenizer) {
      // Tiktoken doesn't have a free method, but we can clear our reference
      this.tokenizer = null;
    }
    tokenizerCache.clear();
  }
}

// Auto-initialize with default model
TokenizerService.initialize();

// Export convenience functions
export const countTokens = TokenizerService.countTokens.bind(TokenizerService);
export const countMessageTokens = TokenizerService.countMessageTokens.bind(TokenizerService);
export const countMessagesTokens = TokenizerService.countMessagesTokens.bind(TokenizerService);
export const countToolTokens = TokenizerService.countToolTokens.bind(TokenizerService);
export const calculateContextTokens = TokenizerService.calculateContextTokens.bind(TokenizerService);
export const truncateToTokenLimit = TokenizerService.truncateToTokenLimit.bind(TokenizerService);
export const estimateCost = TokenizerService.estimateCost.bind(TokenizerService);
export const getModelTokenLimit = TokenizerService.getModelTokenLimit.bind(TokenizerService);
