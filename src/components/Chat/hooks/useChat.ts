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

function buildEffectiveSystemPrompt(
  mode: AppPluginSettings['systemPromptMode'] = 'default',
  customPrompt = ''
): string {
  if (mode === 'replace') {
    return customPrompt || SYSTEM_PROMPT;
  }
  if (mode === 'append' && customPrompt.trim()) {
    return `${SYSTEM_PROMPT}\n\n## Additional Instructions\n\n${customPrompt}`;
  }
  return SYSTEM_PROMPT;
}

export const useChat = (
  pluginSettings: AppPluginSettings,
  sessionIdFromUrl: string | null,
  onSessionIdChange: (sessionId: string | null) => void,
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
  }, [initialSession?.id, initialSession?.messages?.length]);

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

  const sessionManager = useSessionManager(
    orgId,
    chatHistory,
    setChatHistory,
    sessionIdFromUrl,
    onSessionIdChange,
    readOnly
  );

  const hasLoadedFromUrlRef = useRef(false);
  useEffect(() => {
    // Skip loading from URL in investigation mode - session doesn't exist yet
    // and will be created when the auto-send saves the first message
    if (sessionIdFromUrl && !readOnly && !hasLoadedFromUrlRef.current && chatHistory.length === 0 && !initialMessage) {
      hasLoadedFromUrlRef.current = true;
      sessionManager.loadSessionFromUrl(sessionIdFromUrl).catch((error) => {
        console.error('[useChat] Failed to load session from URL:', error);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionIdFromUrl, readOnly, initialMessage]);

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
      sessionManager
        .saveImmediately(newChatHistory, sessionTitleOverrideRef.current)
        .then((createdSessionId) => {
          if (createdSessionId) {
            onSessionIdChange(createdSessionId);
          }
        })
        .catch((error) => {
          console.error('[useChat] Failed to save session:', error);
        });
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
            sessionManager
              .saveImmediately(updated)
              .then((createdSessionId) => {
                if (createdSessionId) {
                  onSessionIdChange(createdSessionId);
                }
              })
              .catch((err) => {
                console.error('[useChat] Failed to save session after error:', err);
              });
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

  useEffect(() => {
    if (toolCalls.size > 0) {
      const toolCallsArray = Array.from(toolCalls.values());
      setChatHistory((prev) =>
        prev.map((msg, idx) =>
          idx === prev.length - 1 && msg.role === 'assistant' ? { ...msg, toolCalls: toolCallsArray } : msg
        )
      );
    }
  }, [toolCalls]);

  const prevIsGeneratingRef = useRef(isGenerating);
  useEffect(() => {
    if (prevIsGeneratingRef.current && !isGenerating && chatHistory.length > 0 && !readOnly) {
      sessionManager
        .saveImmediately(chatHistory)
        .then((createdSessionId) => {
          if (createdSessionId) {
            onSessionIdChange(createdSessionId);
          }
        })
        .catch((error) => {
          console.error('[useChat] Failed to save session after generation:', error);
        });
    }
    prevIsGeneratingRef.current = isGenerating;
  }, [isGenerating, chatHistory, sessionManager, readOnly, onSessionIdChange]);

  useEffect(() => {
    const recovery = ReliabilityService.loadRecoveryState();
    if (recovery && recovery.wasGenerating) {
      ReliabilityService.clearRecoveryState();
    }
  }, []);

  const autoSendStateRef = useRef<'idle' | 'creating-session' | 'ready-to-send' | 'sent'>('idle');
  const [autoSendTrigger, setAutoSendTrigger] = useState(0);

  useEffect(() => {
    if (!initialMessage || readOnly || toolsLoading) {
      return;
    }

    const state = autoSendStateRef.current;

    if (state === 'idle') {
      autoSendStateRef.current = 'creating-session';
      // In investigation mode (when sessionIdFromUrl is set), skip createNewSession
      // as it would clear the URL. The session will be created on first save.
      if (!sessionIdFromUrl) {
        sessionManager.createNewSession();
      }
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
    sessionManager,
    retryCount,
    bottomSpacerRef: bottomSpacerRef as React.RefObject<HTMLDivElement>,
    detectedPageRefs,
  };
};
