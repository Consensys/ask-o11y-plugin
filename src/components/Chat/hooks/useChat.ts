import { useState, useRef, useEffect, useMemo } from 'react';
import { llm } from '@grafana/llm';
import { config } from '@grafana/runtime';
import { ChatMessage, GrafanaPageRef } from '../types';
import { useMCPManager } from './useMCPManager';
import { useStreamManager } from './useStreamManager';
import { useSessionManager } from './useSessionManager';
import { SYSTEM_PROMPT } from '../constants';
import { ConversationMemoryService } from '../../../services/memory';
import { ReliabilityService } from '../../../services/reliability';
import { ValidationService } from '../../../services/validation';
import type { AppPluginSettings } from '../../../types/plugin';

/**
 * Builds the effective system prompt based on the configured mode and custom prompt.
 * - 'default': Uses the built-in SYSTEM_PROMPT
 * - 'replace': Uses only the custom prompt
 * - 'append': Concatenates SYSTEM_PROMPT with the custom prompt
 */
const buildEffectiveSystemPrompt = (
  mode: AppPluginSettings['systemPromptMode'] = 'default',
  customPrompt = ''
): string => {
  switch (mode) {
    case 'replace':
      return customPrompt || SYSTEM_PROMPT; // Fallback to default if custom is empty
    case 'append':
      if (customPrompt.trim()) {
        return `${SYSTEM_PROMPT}\n\n## Additional Instructions\n\n${customPrompt}`;
      }
      return SYSTEM_PROMPT;
    case 'default':
    default:
      return SYSTEM_PROMPT;
  }
};

export const useChat = (pluginSettings: AppPluginSettings) => {
  console.log('[useChat] Hook initialized');

  // Get organization ID from Grafana config
  const orgId = String(config.bootData.user.orgId || '1');

  // Destructure specific settings to avoid unnecessary re-computations
  const { systemPromptMode, customSystemPrompt } = pluginSettings;

  // Compute effective system prompt based on plugin settings
  const effectiveSystemPrompt = useMemo(
    () => buildEffectiveSystemPrompt(systemPromptMode, customSystemPrompt),
    [systemPromptMode, customSystemPrompt]
  );

  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [currentInput, setCurrentInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const bottomSpacerRef = useRef<HTMLDivElement>(null);
  const [isAutoScroll, setIsAutoScroll] = useState(true);
  const [retryCount, setRetryCount] = useState(0);

  const {
    toolCalls,
    toolsLoading,
    toolsError,
    toolsData,
    clearToolCalls,
    handleToolCalls,
    getRunningToolCallsCount,
    formatToolsForOpenAI,
  } = useMCPManager();

  console.log('[useChat] MCP Manager state:', {
    toolsLoading,
    toolsError: !!toolsError,
    toolCount: toolsData?.tools?.length,
  });

  const { handleStreamingChatWithHistory } = useStreamManager(
    setChatHistory,
    handleToolCalls,
    formatToolsForOpenAI,
    pluginSettings
  );

  // Session management with persistence
  const sessionManager = useSessionManager(orgId, chatHistory, setChatHistory);

  // Auto-scroll when chat history changes (only if auto-scroll is enabled)
  useEffect(() => {
    if (isAutoScroll && bottomSpacerRef.current) {
      bottomSpacerRef.current.scrollIntoView({ block: 'end', behavior: 'auto' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatHistory]);

  // Handle scroll: pause auto-scroll when user scrolls up; resume when at bottom
  useEffect(() => {
    const handleScroll = () => {
      const threshold = 50; // px tolerance from the bottom
      const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - threshold;
      setIsAutoScroll(atBottom);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Legacy handleScroll kept for compatibility but not used
  const handleScroll = () => {};

  const sendMessage = async () => {
    console.log('[useChat] sendMessage called', {
      hasInput: !!currentInput.trim(),
      isGenerating,
    });

    if (!currentInput.trim() || isGenerating) {
      console.log('[useChat] sendMessage aborted - conditions not met');
      return;
    }

    // Force auto-scroll to bottom when sending a message
    setIsAutoScroll(true);

    // Validate input before processing
    let validatedInput: string;
    try {
      validatedInput = ValidationService.validateChatInput(currentInput);
      console.log('[useChat] Input validation passed');
    } catch (error) {
      console.error('[useChat] Input validation failed:', error);
      setChatHistory((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: `⚠️ Input validation error: ${error instanceof Error ? error.message : 'Invalid input'}`,
        },
      ]);
      return;
    }

    // Check circuit breaker before attempting
    if (!ReliabilityService.checkCircuitBreaker('llm-stream')) {
      console.log('[useChat] Circuit breaker is open, showing error message');
      setChatHistory((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: '⚠️ The service is temporarily unavailable due to repeated errors. Please try again in a moment.',
        },
      ]);
      return;
    }

    const userMessage: ChatMessage = {
      role: 'user',
      content: validatedInput,
    };

    const newChatHistory = [...chatHistory, userMessage];
    console.log('[useChat] Adding user message to history');
    setChatHistory(newChatHistory);
    setCurrentInput('');
    setIsGenerating(true);
    clearToolCalls();

    const assistantMessage: ChatMessage = {
      role: 'assistant',
      content: '',
      toolCalls: [],
    };

    console.log('[useChat] Adding empty assistant message to history');
    setChatHistory((prev) => [...prev, assistantMessage]);

    // Build context with memory and summarization
    console.log('[useChat] Building context window');
    const messages: llm.Message[] = ConversationMemoryService.buildContextWindow(
      effectiveSystemPrompt,
      newChatHistory,
      sessionManager.currentSummary,
      15 // Keep last 15 messages in full
    );
    console.log('[useChat] Context window built, message count:', messages.length);

    // Save recovery state
    console.log('[useChat] Saving recovery state');
    ReliabilityService.saveRecoveryState({
      sessionId: sessionManager.currentSessionId,
      lastMessageIndex: newChatHistory.length,
      wasGenerating: true,
    });

    try {
      // Call streaming directly - retry logic is complex with RxJS streams
      // The stream manager handles its own error recovery
      const tools = toolsData?.tools || [];
      console.log('[useChat] Calling handleStreamingChatWithHistory with', tools.length, 'tools');
      await handleStreamingChatWithHistory(messages, tools);

      // Success - record for circuit breaker
      console.log('[useChat] Streaming completed successfully');
      ReliabilityService.recordCircuitBreakerSuccess('llm-stream');
      setRetryCount(0);

      // Clear recovery state on success
      ReliabilityService.clearRecoveryState();
    } catch (error) {
      console.error('[useChat] Error in chat completion:', error);

      // Record failure for circuit breaker
      ReliabilityService.recordCircuitBreakerFailure('llm-stream');

      // Get user-friendly error message
      const errorMessage = ReliabilityService.getUserFriendlyErrorMessage(error);

      setChatHistory((prev) =>
        prev.map((msg, idx) =>
          idx === prev.length - 1 && msg.role === 'assistant' ? { ...msg, content: errorMessage } : msg
        )
      );

      // Track retry count
      setRetryCount((prev) => prev + 1);
    } finally {
      console.log('[useChat] Resetting isGenerating to false');
      setIsGenerating(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const clearChat = () => {
    setChatHistory([]);
    clearToolCalls();
    sessionManager.createNewSession();
  };

  // Update chat history with tool calls
  const updateToolCallsInChatHistory = (toolCallsMap: Map<string, any>) => {
    const toolCallsArray = Array.from(toolCallsMap.values());
    setChatHistory((prev) =>
      prev.map((msg, idx) =>
        idx === prev.length - 1 && msg.role === 'assistant' ? { ...msg, toolCalls: toolCallsArray } : msg
      )
    );
  };

  // Watch for tool calls changes and update chat history
  useEffect(() => {
    if (toolCalls.size > 0) {
      updateToolCallsInChatHistory(toolCalls);
    }
  }, [toolCalls]);

  // Recovery on mount
  useEffect(() => {
    const recovery = ReliabilityService.loadRecoveryState();
    if (recovery && recovery.wasGenerating) {
      console.log('[Chat] Recovery state detected, but streaming cannot be resumed. State cleared.');
      ReliabilityService.clearRecoveryState();
    }
  }, []);

  const detectedPageRefs = useMemo((): Array<GrafanaPageRef & { messageIndex: number }> => {
    // Find the most recent message with pageRefs
    for (let i = chatHistory.length - 1; i >= 0; i--) {
      const msg = chatHistory[i];
      if (msg.pageRefs && msg.pageRefs.length > 0) {
        const result = msg.pageRefs.map((ref) => ({ ...ref, messageIndex: i }));
        // #region agent log
        fetch('http://127.0.0.1:7244/ingest/db2b8c3b-e74b-4a86-8af7-7682e8cd5ea9', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            location: 'useChat.ts:detectedPageRefs',
            message: 'Found pageRefs in message',
            data: {
              messageIndex: i,
              chatHistoryLength: chatHistory.length,
              pageRefsCount: result.length,
              urls: result.map((r) => r.url),
            },
            timestamp: Date.now(),
            sessionId: 'debug-session',
            hypothesisId: 'H3',
          }),
        }).catch(() => {});
        // #endregion
        return result;
      }
    }
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/db2b8c3b-e74b-4a86-8af7-7682e8cd5ea9', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        location: 'useChat.ts:detectedPageRefs',
        message: 'No pageRefs found in any message',
        data: { chatHistoryLength: chatHistory.length },
        timestamp: Date.now(),
        sessionId: 'debug-session',
        hypothesisId: 'H3',
      }),
    }).catch(() => {});
    // #endregion
    return [];
  }, [chatHistory]);

  return {
    chatHistory,
    currentInput,
    isGenerating,
    chatContainerRef,
    toolCalls,
    toolsLoading,
    toolsError,
    toolsData,
    setCurrentInput,
    sendMessage,
    handleKeyPress,
    clearChat,
    getRunningToolCallsCount,
    isAutoScroll,
    setIsAutoScroll,
    handleScroll,
    // Session management
    sessionManager,
    retryCount,
    bottomSpacerRef: bottomSpacerRef as React.RefObject<HTMLDivElement>,
    detectedPageRefs,
  };
};
