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
import { ChatSession } from '../../../core/models/ChatSession';
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

export const useChat = (
  pluginSettings: AppPluginSettings,
  initialSession?: ChatSession,
  readOnly?: boolean,
  initialMessage?: string,
  sessionTitleOverride?: string
) => {

  // Get organization ID from Grafana config
  const orgId = String(config.bootData.user.orgId || '1');

  // Destructure specific settings to avoid unnecessary re-computations
  const { systemPromptMode, customSystemPrompt } = pluginSettings;

  // Compute effective system prompt based on plugin settings
  const effectiveSystemPrompt = useMemo(
    () => buildEffectiveSystemPrompt(systemPromptMode, customSystemPrompt),
    [systemPromptMode, customSystemPrompt]
  );

  // Initialize chat history with initial session messages if provided
  // Ensure messages array exists and is not empty
  const initialMessages = initialSession?.messages || [];
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>(initialMessages);
  
  // Update chatHistory when initialSession changes (e.g., when SharedSession loads)
  // Use a ref to track if we've already initialized to avoid unnecessary updates
  const hasInitializedRef = useRef(false);
  const initialSessionIdRef = useRef<string | undefined>(initialSession?.id);
  const initialMessageCountRef = useRef<number>(initialSession?.messages?.length || 0);
  
  useEffect(() => {
    // Only update if we have an initialSession with messages and haven't initialized yet
    // or if the session ID or message count changed (session was updated)
    if (initialSession?.messages && initialSession.messages.length > 0) {
      const sessionIdChanged = initialSessionIdRef.current !== initialSession.id;
      const messageCountChanged = initialMessageCountRef.current !== initialSession.messages.length;
      const shouldUpdate = !hasInitializedRef.current || sessionIdChanged || messageCountChanged;
      
      if (shouldUpdate) {
        setChatHistory(initialSession.messages);
        hasInitializedRef.current = true;
        initialSessionIdRef.current = initialSession.id;
        initialMessageCountRef.current = initialSession.messages.length;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSession?.id, initialSession?.messages?.length]); // Only depend on id and length, not the whole object or chatHistory
  const [currentInput, setCurrentInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const bottomSpacerRef = useRef<HTMLDivElement>(null);
  const [isAutoScroll, setIsAutoScroll] = useState(true);
  const [retryCount, setRetryCount] = useState(0);

  // Store session title override for investigation mode (used once when creating session)
  const sessionTitleOverrideRef = useRef<string | undefined>(sessionTitleOverride);

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

  const { handleStreamingChatWithHistory } = useStreamManager(
    setChatHistory,
    handleToolCalls,
    formatToolsForOpenAI,
    pluginSettings
  );

  // Session management with persistence
  const sessionManager = useSessionManager(orgId, chatHistory, setChatHistory, readOnly);

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
    if (!currentInput.trim() || isGenerating) {
      return;
    }

    // Force auto-scroll to bottom when sending a message
    setIsAutoScroll(true);

    // Validate input before processing
    let validatedInput: string;
    try {
      validatedInput = ValidationService.validateChatInput(currentInput);
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
    setChatHistory(newChatHistory);
    // Save immediately after user input
    // Pass sessionTitleOverride for investigation mode (only used when creating new session)
    if (!readOnly) {
      sessionManager.saveImmediately(newChatHistory, sessionTitleOverrideRef.current);
      // Clear the override after first use (title is only set on session creation)
      sessionTitleOverrideRef.current = undefined;
    }
    setCurrentInput('');
    setIsGenerating(true);
    clearToolCalls();

    const assistantMessage: ChatMessage = {
      role: 'assistant',
      content: '',
      toolCalls: [],
    };

    setChatHistory((prev) => [...prev, assistantMessage]);

    // Build context with memory and summarization
    const messages: llm.Message[] = ConversationMemoryService.buildContextWindow(
      effectiveSystemPrompt,
      newChatHistory,
      sessionManager.currentSummary,
      15 // Keep last 15 messages in full
    );

    // Save recovery state
    ReliabilityService.saveRecoveryState({
      sessionId: sessionManager.currentSessionId,
      lastMessageIndex: newChatHistory.length,
      wasGenerating: true,
    });

    try {
      // Call streaming directly - retry logic is complex with RxJS streams
      // The stream manager handles its own error recovery
      const tools = toolsData?.tools || [];
      await handleStreamingChatWithHistory(messages, tools);

      // Success - record for circuit breaker
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

      // Update chat history with error message and save immediately
      setChatHistory((prev) => {
        const updated = prev.map((msg, idx) =>
          idx === prev.length - 1 && msg.role === 'assistant' ? { ...msg, content: errorMessage } : msg
        );
        
        // Save immediately after error (use setTimeout to ensure state has updated)
        if (!readOnly) {
          setTimeout(() => {
            sessionManager.saveImmediately(updated);
          }, 0);
        }
        
        return updated;
      });

      // Track retry count
      setRetryCount((prev) => prev + 1);
    } finally {
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
    setCurrentInput('');
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

  // Save immediately when streaming completes (isGenerating changes from true to false)
  const prevIsGeneratingRef = useRef(isGenerating);
  useEffect(() => {
    // Save when streaming completes (isGenerating goes from true to false)
    if (prevIsGeneratingRef.current && !isGenerating && chatHistory.length > 0 && !readOnly) {
      sessionManager.saveImmediately(chatHistory);
    }
    prevIsGeneratingRef.current = isGenerating;
  }, [isGenerating, chatHistory, sessionManager, readOnly]);

  // Recovery on mount
  useEffect(() => {
    const recovery = ReliabilityService.loadRecoveryState();
    if (recovery && recovery.wasGenerating) {
      ReliabilityService.clearRecoveryState();
    }
  }, []);

  // Auto-send initial message (for alert investigation mode)
  // This triggers when an initialMessage is provided via URL params
  // Uses two-stage approach to avoid race condition with state updates
  const hasAutoSentRef = useRef(false);
  const shouldAutoSendRef = useRef(false);

  // Stage 1: Set the input when conditions are ready
  useEffect(() => {
    if (
      initialMessage &&
      !hasAutoSentRef.current &&
      !readOnly &&
      !isGenerating &&
      !toolsLoading &&
      chatHistory.length === 0
    ) {
      hasAutoSentRef.current = true;
      shouldAutoSendRef.current = true;
      setCurrentInput(initialMessage);
    }
  }, [initialMessage, toolsLoading, isGenerating, chatHistory.length, readOnly]);

  // Stage 2: Trigger sendMessage when currentInput is set and shouldAutoSend is true
  useEffect(() => {
    if (shouldAutoSendRef.current && currentInput && !isGenerating) {
      shouldAutoSendRef.current = false;
      sendMessage();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentInput, isGenerating]);

  const detectedPageRefs = useMemo((): Array<GrafanaPageRef & { messageIndex: number }> => {
    for (let i = chatHistory.length - 1; i >= 0; i--) {
      const msg = chatHistory[i];
      // Only return when we find an assistant message WITH pageRefs
      if (msg.role === 'assistant' && msg.pageRefs && msg.pageRefs.length > 0) {
        return msg.pageRefs.map((ref) => ({ ...ref, messageIndex: i }));
      }
      // Continue searching if assistant message has no pageRefs
    }
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
