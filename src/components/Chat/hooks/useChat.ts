import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { config } from '@grafana/runtime';
import { ChatMessage, GrafanaPageRef, RenderedToolCall } from '../types';
import { useSessionManager } from './useSessionManager';
import { SYSTEM_PROMPT } from '../constants';
import { ValidationService } from '../../../services/validation';
import { parseGrafanaLinks } from '../utils/grafanaLinkParser';
import {
  runAgentDetached,
  reconnectToAgentRun,
  cancelAgentRun,
  type AgentCallbacks,
  type ContentEvent,
  type ToolCallStartEvent,
  type ToolCallResultEvent,
} from '../../../services/agentClient';
import { getSession } from '../../../services/backendSessionClient';
import type { AppPluginSettings } from '../../../types/plugin';
import { MAX_TOTAL_TOKENS } from '../../../constants';

interface InitialSessionData {
  id?: string;
  messages?: ChatMessage[];
}

function updateLastAssistantMessage(
  history: ChatMessage[],
  updater: (msg: ChatMessage) => ChatMessage
): ChatMessage[] {
  return history.map((msg, idx) =>
    idx === history.length - 1 && msg.role === 'assistant' ? updater(msg) : msg
  );
}

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

export function useChat(
  pluginSettings: AppPluginSettings,
  sessionIdFromUrl: string | null,
  onSessionIdChange: (sessionId: string | null) => void,
  initialSession?: InitialSessionData,
  readOnly?: boolean,
  initialMessage?: string,
  sessionTitleOverride?: string
) {
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
  const initialMessageCountRef = useRef<number>(initialSession?.messages?.length ?? 0);

  useEffect(() => {
    if (!initialSession?.messages || initialSession.messages.length === 0) {
      return;
    }

    const sessionIdChanged = initialSessionIdRef.current !== initialSession.id;
    const messageCountChanged = initialMessageCountRef.current !== initialSession.messages.length;
    const shouldUpdate = !hasInitializedRef.current || sessionIdChanged || messageCountChanged;

    if (shouldUpdate) {
      setChatHistory(initialSession.messages);
      hasInitializedRef.current = true;
      initialSessionIdRef.current = initialSession.id;
      initialMessageCountRef.current = initialSession.messages.length;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSession?.id, initialSession?.messages?.length]);

  const [currentInput, setCurrentInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const bottomSpacerRef = useRef<HTMLDivElement>(null);
  const [isAutoScroll, setIsAutoScroll] = useState(true);
  const [retryCount, setRetryCount] = useState(0);
  const [toolCalls, setToolCalls] = useState<Map<string, RenderedToolCall>>(new Map());
  const [messageQueue, setMessageQueue] = useState<string[]>([]);

  const abortControllerRef = useRef<AbortController | null>(null);
  const activeRunIdRef = useRef<string | null>(null);

  const sessionTitleOverrideRef = useRef<string | undefined>(sessionTitleOverride);
  useEffect(() => {
    if (sessionTitleOverride) {
      sessionTitleOverrideRef.current = sessionTitleOverride;
    }
  }, [sessionTitleOverride]);

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
    if (sessionIdFromUrl && !readOnly && !hasLoadedFromUrlRef.current && chatHistory.length === 0 && !initialMessage) {
      hasLoadedFromUrlRef.current = true;
      sessionManager.loadSession(sessionIdFromUrl).catch((error) => {
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
    const SCROLL_THRESHOLD = 50;
    function handleScroll(): void {
      const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - SCROLL_THRESHOLD;
      setIsAutoScroll(atBottom);
    }
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  const appendErrorMessage = (content: string): void => {
    setChatHistory((prev) => [...prev, { role: 'assistant', content }]);
  };

  const getRunningToolCallsCount = useCallback((): number => {
    return Array.from(toolCalls.values()).filter((tc) => tc.running).length;
  }, [toolCalls]);

  const makeCallbacks = useCallback(
    (abortController: AbortController, hadErrorRef: { current: boolean }): AgentCallbacks => ({
      onContent: (event: ContentEvent) => {
        if (abortController.signal.aborted) {
          return;
        }
        setChatHistory((prev) =>
          updateLastAssistantMessage(prev, (msg) => {
            const accumulated = msg.content + event.content;
            return {
              ...msg,
              content: accumulated,
              pageRefs: parseGrafanaLinks(accumulated),
            };
          })
        );
      },
      onToolCallStart: (event: ToolCallStartEvent) => {
        if (abortController.signal.aborted) {
          return;
        }
        setToolCalls((prev) => {
          const next = new Map(prev);
          next.set(event.id, { name: event.name, arguments: event.arguments, running: true });
          return next;
        });
      },
      onToolCallResult: (event: ToolCallResultEvent) => {
        if (abortController.signal.aborted) {
          return;
        }
        setToolCalls((prev) => {
          const next = new Map(prev);
          const existing = next.get(event.id);
          next.set(event.id, {
            name: event.name,
            arguments: existing?.arguments || '',
            running: false,
            error: event.isError ? event.content : undefined,
            response: event.isError ? undefined : { content: [{ type: 'text', text: event.content }] },
          });
          return next;
        });
      },
      onDone: () => {},
      onReconnect: () => {
        setChatHistory((prev) =>
          updateLastAssistantMessage(prev, (msg) => ({
            ...msg,
            content: '',
            pageRefs: undefined,
          }))
        );
        setToolCalls(new Map());
      },
      onError: (message: string) => {
        hadErrorRef.current = true;
        console.error('[useChat] Agent error:', message);
        setChatHistory((prev) =>
          updateLastAssistantMessage(prev, (msg) => ({
            ...msg,
            content: msg.content ? msg.content + '\n\n**Error:** ' + message : message,
          }))
        );
      },
    }),
    []
  );

  const sendMessage = async (explicitInput?: string): Promise<void> => {
    const inputToSend = explicitInput ?? currentInput;
    if (!inputToSend.trim()) {
      return;
    }

    setIsAutoScroll(true);

    let validatedInput: string;
    try {
      validatedInput = ValidationService.validateChatInput(inputToSend);
    } catch (error) {
      console.error('[useChat] Input validation failed:', error);
      appendErrorMessage(`Input validation error: ${error instanceof Error ? error.message : 'Invalid input'}`);
      return;
    }

    if (isGenerating) {
      setMessageQueue((prev) => [...prev, validatedInput]);
      setCurrentInput('');
      return;
    }

    const userMessage: ChatMessage = { role: 'user', content: validatedInput };
    const newChatHistory = [...chatHistory, userMessage];
    setChatHistory(newChatHistory);
    setCurrentInput('');
    setIsGenerating(true);
    setToolCalls(new Map());

    setChatHistory((prev) => [...prev, { role: 'assistant', content: '', toolCalls: [] }]);
    const messagesForBackend = newChatHistory
      .filter((m) => m.role !== 'assistant' || m.content.trim() !== '' || (m.toolCalls && m.toolCalls.length > 0))
      .map((m) => ({ role: m.role, content: m.content }));

    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    const hadErrorRef = { current: false };

    try {
      const result = await runAgentDetached({
        messages: messagesForBackend,
        systemPrompt: effectiveSystemPrompt,
        summary: '',
        maxTotalTokens: pluginSettings.maxTotalTokens || MAX_TOTAL_TOKENS,
        recentMessageCount: 15,
        orgId,
        orgName: config.bootData.user.orgName || '',
        sessionId: sessionManager.currentSessionId || undefined,
        title: sessionTitleOverrideRef.current,
      });

      activeRunIdRef.current = result.runId;

      if (result.sessionId && !sessionManager.currentSessionId) {
        sessionManager.setCurrentSessionIdDirect(result.sessionId);
        onSessionIdChange(result.sessionId);
      }

      sessionTitleOverrideRef.current = undefined;

      const callbacks = makeCallbacks(abortController, hadErrorRef);
      await reconnectToAgentRun(result.runId, callbacks, orgId, abortController.signal);

      activeRunIdRef.current = null;

      if (!readOnly) {
        sessionManager.refreshSessions().catch(() => {});
      }

      if (hadErrorRef.current) {
        setRetryCount((prev) => prev + 1);
      } else {
        setRetryCount(0);
      }
    } catch (error) {
      activeRunIdRef.current = null;

      if (error instanceof DOMException && error.name === 'AbortError') {
        setChatHistory((prev) =>
          updateLastAssistantMessage(prev, (msg) => ({
            ...msg,
            content: msg.content + '\n\n*[Generation stopped]*',
          }))
        );
        return;
      }
      console.error('[useChat] Error in agent run:', error);
      setChatHistory((prev) =>
        updateLastAssistantMessage(prev, (msg) => ({
          ...msg,
          content: error instanceof Error ? error.message : 'An unexpected error occurred',
        }))
      );
      setRetryCount((prev) => prev + 1);
    } finally {
      setIsGenerating(false);
      if (abortControllerRef.current === abortController) {
        abortControllerRef.current = null;
      }
    }
  };

  useEffect(() => {
    if (toolCalls.size > 0) {
      const toolCallsArray = Array.from(toolCalls.values());
      setChatHistory((prev) =>
        updateLastAssistantMessage(prev, (msg) => ({ ...msg, toolCalls: toolCallsArray }))
      );
    }
  }, [toolCalls]);

  const stopGeneration = useCallback((): void => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const runId = activeRunIdRef.current;
    if (runId) {
      cancelAgentRun(runId, orgId).catch((err) => {
        console.error('[useChat] Failed to cancel agent run:', err);
      });
      activeRunIdRef.current = null;
    }
    setMessageQueue([]);
  }, [orgId]);

  // Reconnect to an active run on mount / session change (using backend activeRunId)
  const hasAttemptedReconnectRef = useRef<string | null>(null);
  useEffect(() => {
    const sessionId = sessionManager.currentSessionId;
    if (!sessionId || readOnly || isGenerating) {
      return;
    }

    if (hasAttemptedReconnectRef.current === sessionId) {
      return;
    }

    hasAttemptedReconnectRef.current = sessionId;

    let cancelled = false;
    const abortController = new AbortController();

    const reconnect = async () => {
      try {
        const session = await getSession(sessionId);
        if (cancelled || !session.activeRunId) {
          return;
        }

        const activeRunId = session.activeRunId;

        setIsReconnecting(true);
        setIsGenerating(true);
        setToolCalls(new Map());

        setChatHistory((prev) => {
          const lastMsg = prev[prev.length - 1];
          if (lastMsg?.role === 'assistant' && lastMsg.content === '') {
            return prev;
          }
          return [...prev, { role: 'assistant', content: '', toolCalls: [] }];
        });

        abortControllerRef.current = abortController;
        activeRunIdRef.current = activeRunId;

        const hadErrorRef = { current: false };
        const callbacks = makeCallbacks(abortController, hadErrorRef);
        await reconnectToAgentRun(activeRunId, callbacks, orgId, abortController.signal);
      } catch (err) {
        if (!cancelled) {
          console.error('[useChat] Reconnection failed:', err);
          setChatHistory((prev) =>
            updateLastAssistantMessage(prev, (msg) => ({
              ...msg,
              content: msg.content || 'Failed to reconnect to the previous response. Please try sending your message again.',
            }))
          );
        }
      } finally {
        if (!cancelled) {
          activeRunIdRef.current = null;
          setIsReconnecting(false);
          setIsGenerating(false);
          if (abortControllerRef.current === abortController) {
            abortControllerRef.current = null;
          }
        }
      }
    };

    reconnect();

    return () => {
      cancelled = true;
      // Only abort if we're not actively generating (to avoid aborting mid-stream when sessionId is set)
      if (!isGenerating) {
        abortController.abort();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionManager.currentSessionId, readOnly]);

  // Drain queued messages after generation completes.
  useEffect(() => {
    if (!isGenerating && messageQueue.length > 0) {
      const [nextMessage, ...remaining] = messageQueue;
      setMessageQueue(remaining);
      sendMessage(nextMessage);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGenerating, messageQueue.length]);

  const handleKeyPress = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const clearChat = (): void => {
    setChatHistory([]);
    setCurrentInput('');
    setToolCalls(new Map());
    setMessageQueue([]);
    sessionManager.createNewSession();
  };

  const autoSendStateRef = useRef<'idle' | 'creating-session' | 'ready-to-send' | 'sent'>('idle');
  const [autoSendTrigger, setAutoSendTrigger] = useState(0);

  useEffect(() => {
    if (!initialMessage || readOnly) {
      return;
    }

    const state = autoSendStateRef.current;

    if (state === 'idle') {
      autoSendStateRef.current = 'creating-session';
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
  }, [initialMessage, readOnly, chatHistory.length, isGenerating, currentInput, autoSendTrigger]);

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
    isReconnecting,
    chatContainerRef,
    toolCalls,
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
    messageQueue,
    stopGeneration,
  };
}
