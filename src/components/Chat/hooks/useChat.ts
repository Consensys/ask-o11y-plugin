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

  const orgId = String(config.bootData.user.orgId || '1');
  const { systemPromptMode, customSystemPrompt } = pluginSettings;

  const effectiveSystemPrompt = useMemo(
    () => buildEffectiveSystemPrompt(systemPromptMode, customSystemPrompt),
    [systemPromptMode, customSystemPrompt]
  );

  const initialMessages = initialSession?.messages || [];
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>(initialMessages);

  const hasInitializedRef = useRef(false);
  const initialSessionIdRef = useRef<string | undefined>(initialSession?.id);
  const initialMessageCountRef = useRef<number>(initialSession?.messages?.length || 0);
  
  useEffect(() => {
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

  const sessionTitleOverrideRef = useRef<string | undefined>(sessionTitleOverride);
  useEffect(() => {
    if (sessionTitleOverride) {
      sessionTitleOverrideRef.current = sessionTitleOverride;
    }
  }, [sessionTitleOverride]);

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

  const sessionManager = useSessionManager(orgId, chatHistory, setChatHistory, readOnly);

  useEffect(() => {
    if (isAutoScroll && bottomSpacerRef.current) {
      bottomSpacerRef.current.scrollIntoView({ block: 'end', behavior: 'auto' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatHistory]);

  useEffect(() => {
    const handleScroll = () => {
      const threshold = 50;
      const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - threshold;
      setIsAutoScroll(atBottom);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const handleScroll = () => {};

  const sendMessage = async () => {
    if (!currentInput.trim() || isGenerating) {
      return;
    }

    setIsAutoScroll(true);

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
    if (!readOnly) {
      sessionManager.saveImmediately(newChatHistory, sessionTitleOverrideRef.current);
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

    const messages: llm.Message[] = ConversationMemoryService.buildContextWindow(
      effectiveSystemPrompt,
      newChatHistory,
      sessionManager.currentSummary,
      15
    );

    ReliabilityService.saveRecoveryState({
      sessionId: sessionManager.currentSessionId,
      lastMessageIndex: newChatHistory.length,
      wasGenerating: true,
    });

    try {
      const tools = toolsData?.tools || [];
      await handleStreamingChatWithHistory(messages, tools);

      ReliabilityService.recordCircuitBreakerSuccess('llm-stream');
      setRetryCount(0);
      ReliabilityService.clearRecoveryState();
    } catch (error) {
      console.error('[useChat] Error in chat completion:', error);
      ReliabilityService.recordCircuitBreakerFailure('llm-stream');
      const errorMessage = ReliabilityService.getUserFriendlyErrorMessage(error);

      setChatHistory((prev) => {
        const updated = prev.map((msg, idx) =>
          idx === prev.length - 1 && msg.role === 'assistant' ? { ...msg, content: errorMessage } : msg
        );

        if (!readOnly) {
          setTimeout(() => {
            sessionManager.saveImmediately(updated);
          }, 0);
        }

        return updated;
      });

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

  const updateToolCallsInChatHistory = (toolCallsMap: Map<string, any>) => {
    const toolCallsArray = Array.from(toolCallsMap.values());
    setChatHistory((prev) =>
      prev.map((msg, idx) =>
        idx === prev.length - 1 && msg.role === 'assistant' ? { ...msg, toolCalls: toolCallsArray } : msg
      )
    );
  };

  useEffect(() => {
    if (toolCalls.size > 0) {
      updateToolCallsInChatHistory(toolCalls);
    }
  }, [toolCalls]);

  const prevIsGeneratingRef = useRef(isGenerating);
  useEffect(() => {
    if (prevIsGeneratingRef.current && !isGenerating && chatHistory.length > 0 && !readOnly) {
      sessionManager.saveImmediately(chatHistory);
    }
    prevIsGeneratingRef.current = isGenerating;
  }, [isGenerating, chatHistory, sessionManager, readOnly]);

  useEffect(() => {
    const recovery = ReliabilityService.loadRecoveryState();
    if (recovery && recovery.wasGenerating) {
      ReliabilityService.clearRecoveryState();
    }
  }, []);

  // Auto-send initialMessage (investigation mode): idle -> creating-session -> ready-to-send -> sent
  const autoSendStateRef = useRef<'idle' | 'creating-session' | 'ready-to-send' | 'sent'>('idle');
  const [autoSendTrigger, setAutoSendTrigger] = useState(0);

  useEffect(() => {
    if (!initialMessage || readOnly || toolsLoading) {
      return;
    }

    const state = autoSendStateRef.current;

    if (state === 'idle') {
      autoSendStateRef.current = 'creating-session';
      sessionManager.createNewSession();
      setAutoSendTrigger((prev) => prev + 1);
      return;
    }

    if (state === 'creating-session' && chatHistory.length === 0 && !isGenerating) {
      autoSendStateRef.current = 'ready-to-send';
      setCurrentInput(initialMessage);
      return;
    }

    if (state === 'ready-to-send' && currentInput === initialMessage && !isGenerating) {
      autoSendStateRef.current = 'sent';
      sendMessage();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMessage, toolsLoading, readOnly, chatHistory.length, isGenerating, currentInput, autoSendTrigger]);

  const detectedPageRefs = useMemo((): Array<GrafanaPageRef & { messageIndex: number }> => {
    for (let i = chatHistory.length - 1; i >= 0; i--) {
      const msg = chatHistory[i];
      if (msg.role === 'assistant' && msg.pageRefs && msg.pageRefs.length > 0) {
        return msg.pageRefs.map((ref) => ({ ...ref, messageIndex: i }));
      }
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
    sessionManager,
    retryCount,
    bottomSpacerRef: bottomSpacerRef as React.RefObject<HTMLDivElement>,
    detectedPageRefs,
  };
};
