import { useRef, useEffect, useCallback } from 'react';
import { llm } from '@grafana/llm';
import { ChatMessage } from '../types';
import {
  MAX_TOTAL_TOKENS,
  SYSTEM_MESSAGE_BUFFER,
  MAX_TOOL_RESPONSE_TOKENS,
  AGGRESSIVE_TOOL_RESPONSE_TOKENS,
  LLM_API_TIMEOUT_MS,
} from '../../../constants';
import { TokenizerService, truncateToTokenLimit } from '../../../services/tokenizer';
import { llmRequestQueue } from '../../../services/queue';
import type { AppPluginSettings } from '../../../types/plugin';

// Simulate streaming by updating content incrementally
const SIMULATE_STREAMING = true;
const CHARS_PER_UPDATE = 50;
const UPDATE_INTERVAL_MS = 30;

// Trim tool response content if it's too large
const trimToolResponseContent = (
  content: string,
  maxTokens: number = MAX_TOOL_RESPONSE_TOKENS
): { content: string; wasTrimmed: boolean } => {
  const actualTokens = TokenizerService.countTokens(content);
  if (actualTokens <= maxTokens) {
    return { content, wasTrimmed: false };
  }

  // Use the tokenizer to truncate precisely to the token limit
  const trimmedContent = truncateToTokenLimit(content, maxTokens, true);
  return { content: trimmedContent, wasTrimmed: true };
};

// Create a trimmed version of a message, handling tool responses specially
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

// Trim messages to stay within token limit while preserving system message and recent context
const trimMessagesToTokenLimit = (messages: llm.Message[], tools: any[], maxTokens: number): llm.Message[] => {
  const formattedTools = tools;
  let contextInfo = TokenizerService.calculateContextTokens(messages, formattedTools);

  // If we're already under the limit, return as-is
  if (contextInfo.totalTokens <= maxTokens) {
    return messages;
  }

  console.warn(`⚠️ Token limit exceeded: ${contextInfo.totalTokens} > ${maxTokens}. Trimming messages...`);
  console.log(`📊 Token breakdown:`, contextInfo.breakdown);

  // First pass: Trim large tool responses in place
  let messagesWithTrimmedTools = messages.map((msg) => {
    const { message, wasTrimmed } = trimMessageContent(msg);
    if (wasTrimmed) {
      console.log(`✂️ Trimmed large tool response in message`);
    }
    return message;
  });

  // Recalculate tokens after tool response trimming
  contextInfo = TokenizerService.calculateContextTokens(messagesWithTrimmedTools, formattedTools);

  // If still over limit after tool trimming, try aggressive trimming
  if (contextInfo.totalTokens > maxTokens) {
    console.log(
      `⚠️ Still over limit after normal trimming (${contextInfo.totalTokens}). Applying aggressive tool response trimming...`
    );

    messagesWithTrimmedTools = messages.map((msg) => {
      const { message, wasTrimmed } = trimMessageContent(msg, true); // aggressive = true
      if (wasTrimmed) {
        console.log(`✂️ Aggressively trimmed tool response in message`);
      }
      return message;
    });

    contextInfo = TokenizerService.calculateContextTokens(messagesWithTrimmedTools, formattedTools);
  }

  // If resolved after tool trimming, return early
  if (contextInfo.totalTokens <= maxTokens) {
    console.log(`✂️ Token limit resolved by trimming tool responses. Final tokens: ${contextInfo.totalTokens}`);
    return messagesWithTrimmedTools;
  }

  // Always preserve the system message (first message) if it exists
  const systemMessage =
    messagesWithTrimmedTools.length > 0 && messagesWithTrimmedTools[0].role === 'system'
      ? messagesWithTrimmedTools[0]
      : null;
  const nonSystemMessages = systemMessage ? messagesWithTrimmedTools.slice(1) : messagesWithTrimmedTools;

  // Start with system message and work backwards from the most recent messages
  let trimmedMessages: llm.Message[] = systemMessage ? [systemMessage] : [];
  let targetTokens = maxTokens - SYSTEM_MESSAGE_BUFFER;

  // Add messages from newest to oldest until we hit the token limit
  for (let i = nonSystemMessages.length - 1; i >= 0; i--) {
    const testMessages = [systemMessage, ...nonSystemMessages.slice(i)].filter(Boolean) as llm.Message[];
    const testContextInfo = TokenizerService.calculateContextTokens(testMessages, formattedTools);

    if (testContextInfo.totalTokens <= targetTokens) {
      trimmedMessages = testMessages;
      break;
    }
  }

  // If we still can't fit anything, keep only system message and the most recent message
  if (trimmedMessages.length <= (systemMessage ? 1 : 0) && nonSystemMessages.length > 0) {
    trimmedMessages = systemMessage
      ? [systemMessage, nonSystemMessages[nonSystemMessages.length - 1]]
      : [nonSystemMessages[nonSystemMessages.length - 1]];
  }

  const finalContextInfo = TokenizerService.calculateContextTokens(trimmedMessages, formattedTools);

  // Log detailed trimming summary with accurate token counts
  const removedMessages = messages.length - trimmedMessages.length;
  const toolMessagesRemoved =
    messages.filter((m) => m.role === 'tool').length - trimmedMessages.filter((m) => m.role === 'tool').length;
  const userMessagesRemoved =
    messages.filter((m) => m.role === 'user').length - trimmedMessages.filter((m) => m.role === 'user').length;
  const assistantMessagesRemoved =
    messages.filter((m) => m.role === 'assistant').length -
    trimmedMessages.filter((m) => m.role === 'assistant').length;

  console.log(`✂️ Message trimming summary:`, {
    totalMessages: `${messages.length} → ${trimmedMessages.length} (removed ${removedMessages})`,
    tokens: `${contextInfo.totalTokens} → ${finalContextInfo.totalTokens}`,
    accurateBreakdown: finalContextInfo.breakdown,
    removedByType: {
      tool: toolMessagesRemoved,
      user: userMessagesRemoved,
      assistant: assistantMessagesRemoved,
    },
  });

  return trimmedMessages;
};

// Simulate streaming by gradually revealing content with cancellation support
const simulateStreaming = async (
  content: string,
  updateCallback: (partialContent: string) => void,
  abortSignal?: AbortSignal
): Promise<void> => {
  if (!SIMULATE_STREAMING || !content) {
    updateCallback(content);
    return;
  }

  let currentIndex = 0;
  while (currentIndex < content.length) {
    // Check if we should abort
    if (abortSignal?.aborted) {
      console.log('[simulateStreaming] Aborted');
      throw new DOMException('Streaming aborted', 'AbortError');
    }

    const nextIndex = Math.min(currentIndex + CHARS_PER_UPDATE, content.length);
    const partialContent = content.slice(0, nextIndex);
    updateCallback(partialContent);
    currentIndex = nextIndex;

    if (currentIndex < content.length) {
      await new Promise((resolve, reject) => {
        const timeoutId = setTimeout(resolve, UPDATE_INTERVAL_MS);

        // Clean up timeout if aborted
        if (abortSignal) {
          const abortHandler = () => {
            clearTimeout(timeoutId);
            reject(new DOMException('Streaming aborted', 'AbortError'));
          };

          if (abortSignal.aborted) {
            abortHandler();
          } else {
            abortSignal.addEventListener('abort', abortHandler, { once: true });
          }
        }
      });
    }
  }
};

// Wrapper to add timeout to API calls
const withTimeout = <T>(promise: Promise<T>, timeoutMs: number, operationName: string): Promise<T> => {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(`${operationName} timed out after ${timeoutMs}ms. The LLM API may be slow or unresponsive.`)
          ),
        timeoutMs
      )
    ),
  ]);
};

export const useStreamManager = (
  setChatHistory: React.Dispatch<React.SetStateAction<ChatMessage[]>>,
  handleToolCalls: (
    toolCalls: Array<{ function: { name: string; arguments: string }; id: string }>,
    messages: llm.Message[]
  ) => Promise<void>,
  formatToolsForOpenAI: (tools: any[]) => any[],
  pluginSettings: AppPluginSettings
) => {
  // Use refs to store abort controller and cleanup flags
  const abortControllerRef = useRef<AbortController | null>(null);
  const isStreamingRef = useRef(false);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      // Abort any ongoing streaming when component unmounts
      if (abortControllerRef.current) {
        console.log('[useStreamManager] Cleaning up: aborting streaming');
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      isStreamingRef.current = false;
    };
  }, []);

  // Get the effective max tokens from plugin settings or use fallback
  const getEffectiveMaxTokens = useCallback(() => {
    return pluginSettings.maxTotalTokens || MAX_TOTAL_TOKENS;
  }, [pluginSettings.maxTotalTokens]);

  const handleStreamingChatWithHistory = useCallback(
    async (messages: llm.Message[], tools: any[]) => {
      // Create new abort controller for this streaming session
      const abortController = new AbortController();
      abortControllerRef.current = abortController;
      const formattedTools = formatToolsForOpenAI(tools);
      const effectiveMaxTokens = getEffectiveMaxTokens();

      // Trim messages to stay within token limit
      const trimmedMessages = trimMessagesToTokenLimit(messages, formattedTools, effectiveMaxTokens);
      const contextInfo = TokenizerService.calculateContextTokens(trimmedMessages, formattedTools);

      console.log('🔄 Starting LLM request with context:', {
        originalMessageCount: messages.length,
        trimmedMessageCount: trimmedMessages.length,
        toolCount: formattedTools.length,
        accurateTokens: {
          messages: contextInfo.messageTokens,
          tools: contextInfo.toolTokens,
          total: contextInfo.totalTokens,
          breakdown: contextInfo.breakdown,
        },
      });

      const requestStartTime = Date.now();
      console.log('[API] Sending request at', new Date().toISOString());

      try {
        // Queue the LLM request to prevent overwhelming the API
        const response = await llmRequestQueue.add(
          () =>
            withTimeout(
              llm.chatCompletions({
                model: llm.Model.LARGE,
                messages: trimmedMessages,
                tools: formattedTools,
              }),
              LLM_API_TIMEOUT_MS,
              'LLM API request'
            ),
          {
            priority: 10, // High priority for user-initiated requests
            maxRetries: 2,
          }
        );

        const elapsed = Date.now() - requestStartTime;
        console.log(`[API] ✅ Response received after ${elapsed}ms`);
        console.log('[API] Response structure:', {
          hasChoices: !!response.choices,
          choicesLength: response.choices?.length,
          firstChoice: response.choices?.[0],
        });

        const firstChoice = response.choices?.[0];
        if (!firstChoice) {
          throw new Error('No response from LLM');
        }

        const message = firstChoice.message;
        console.log('[API] Message:', {
          role: message.role,
          hasContent: !!message.content,
          contentLength: message.content?.length,
          hasToolCalls: !!message.tool_calls,
          toolCallsCount: message.tool_calls?.length || 0,
        });

        // Handle content response with simulated streaming
        if (message.content) {
          console.log('[Content] Simulating streaming for content');

          // Check if we should abort before streaming
          if (abortController.signal.aborted) {
            throw new DOMException('Request aborted', 'AbortError');
          }

          await simulateStreaming(
            message.content,
            (partialContent) => {
              // Only update if not aborted
              if (!abortController.signal.aborted) {
                setChatHistory((prev) =>
                  prev.map((msg, idx) =>
                    idx === prev.length - 1 && msg.role === 'assistant' ? { ...msg, content: partialContent } : msg
                  )
                );
              }
            },
            abortController.signal
          );
          console.log('[Content] Finished displaying content');
        }

        // Handle tool calls
        if (message.tool_calls && message.tool_calls.length > 0) {
          console.log(`[Tool Calls] Processing ${message.tool_calls.length} tool calls`);

          // Check if aborted before processing tool calls
          if (abortController.signal.aborted) {
            throw new DOMException('Request aborted', 'AbortError');
          }

          // Add the assistant message with tool calls to history
          messages.push(message as any);

          // Filter for function tool calls
          const functionToolCalls = message.tool_calls.filter((tc: any) => tc.type === 'function');
          console.log(`[Tool Calls] Filtered to ${functionToolCalls.length} function calls`);

          // Execute tool calls
          await handleToolCalls(functionToolCalls as any, messages);

          // Make another request with tool results
          console.log('[Tool Calls] Making follow-up request with tool results');
          const newTrimmedMessages = trimMessagesToTokenLimit(messages, formattedTools, effectiveMaxTokens);
          const updatedContextInfo = TokenizerService.calculateContextTokens(newTrimmedMessages, formattedTools);

          console.log('🔄 Continuing after tool calls:', {
            originalMessageCount: messages.length,
            trimmedMessageCount: newTrimmedMessages.length,
            toolCount: formattedTools.length,
            accurateTokens: {
              messages: updatedContextInfo.messageTokens,
              tools: updatedContextInfo.toolTokens,
              total: updatedContextInfo.totalTokens,
              breakdown: updatedContextInfo.breakdown,
            },
            toolCallsProcessed: functionToolCalls.length,
          });

          // Recursive call to handle the response after tool execution
          // Note: This maintains the same abort controller through the recursion
          await handleStreamingChatWithHistory(messages, tools);
        }

        console.log('[API] Request completed successfully');
      } catch (error) {
        const elapsed = Date.now() - requestStartTime;

        // Handle abort errors gracefully
        if (error instanceof DOMException && error.name === 'AbortError') {
          console.log(`[API] Request aborted after ${elapsed}ms`);
          // Don't rethrow abort errors - they're expected during cleanup
          return;
        }

        console.error(`[API] Error after ${elapsed}ms:`, error);
        throw error;
      } finally {
        // Clean up abort controller reference if this is the current one
        if (abortControllerRef.current === abortController) {
          abortControllerRef.current = null;
        }
        isStreamingRef.current = false;
      }
    },
    [formatToolsForOpenAI, getEffectiveMaxTokens, setChatHistory, handleToolCalls]
  );

  return { handleStreamingChatWithHistory };
};
