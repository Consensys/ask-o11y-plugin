import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { usePluginUserStorage } from '@grafana/runtime';
import { ChatMessage } from '../types';
import { SessionMetadata } from '../../../core';
import { ServiceFactory } from '../../../core/services/ServiceFactory';
import { ConversationMemoryService } from '../../../services/memory';

export interface UseSessionManagerReturn {
  // Current session state
  currentSessionId: string | null;
  sessions: SessionMetadata[];
  currentSummary: string | undefined;

  // Session operations
  createNewSession: () => Promise<void>;
  loadSession: (sessionId: string) => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;
  deleteAllSessions: () => Promise<void>;

  // Immediate save (with optional title override for investigation mode)
  saveImmediately: (messages: ChatMessage[], titleOverride?: string) => Promise<void>;

  // Refresh sessions list
  refreshSessions: () => Promise<void>;
  // Load current session if chatHistory is empty
  loadCurrentSessionIfNeeded: () => Promise<void>;

  // Summarization
  triggerSummarization: (messages: ChatMessage[]) => Promise<void>;
  isSummarizing: boolean;

  // Storage stats
  storageStats: { used: number; total: number; sessionCount: number };
}

export const useSessionManager = (
  orgId: string,
  chatHistory: ChatMessage[],
  setChatHistory: React.Dispatch<React.SetStateAction<ChatMessage[]>>,
  readOnly?: boolean
): UseSessionManagerReturn => {
  const storage = usePluginUserStorage();
  const sessionService = useMemo(() => ServiceFactory.getSessionService(storage), [storage]);

  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionMetadata[]>([]);
  const [currentSummary, setCurrentSummary] = useState<string | undefined>(undefined);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [storageStats, setStorageStats] = useState({ used: 0, total: 0, sessionCount: 0 });

  const isSavingRef = useRef(false);
  const lastInitializedOrgIdRef = useRef<string | null>(null);
  const initialChatHistoryLengthRef = useRef<number>(chatHistory.length);

  useEffect(() => {
    if (initialChatHistoryLengthRef.current === 0 && chatHistory.length > 0) {
      initialChatHistoryLengthRef.current = chatHistory.length;
    } else if (chatHistory.length === 0) {
      initialChatHistoryLengthRef.current = 0;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  const refreshSessions = useCallback(async () => {
    try {
      const loadedSessions = await sessionService.getAllSessions(orgId);
      setSessions(loadedSessions);
      const stats = await sessionService.getStorageStats(orgId);
      setStorageStats(stats);
    } catch (error) {
      console.error('[SessionManager] Failed to refresh sessions:', error);
    }
  }, [sessionService, orgId]);

  /**
   * Load current session if chatHistory is empty (e.g., on page refresh)
   */
  const loadCurrentSessionIfNeeded = useCallback(async () => {
    if (readOnly || chatHistory.length > 0 || currentSessionId !== null) {
      return;
    }

    try {
      const session = await sessionService.getCurrentSession(orgId);
      if (session) {
        setCurrentSessionId(session.id);
        setChatHistory(session.messages);
        setCurrentSummary(session.summary);
      }
    } catch (error) {
      console.error('[SessionManager] Failed to load current session:', error);
    }
  }, [sessionService, orgId, chatHistory.length, currentSessionId, readOnly, setChatHistory]);

  useEffect(() => {
    if (lastInitializedOrgIdRef.current === orgId) {
      return;
    }

    lastInitializedOrgIdRef.current = orgId;
    
    let cancelled = false;
    
    const initialize = async () => {
      try {
        const loadedSessions = await sessionService.getAllSessions(orgId);
        if (!cancelled) {
          setSessions(loadedSessions);
        } else {
        }
        
        const stats = await sessionService.getStorageStats(orgId);
        if (!cancelled) {
          setStorageStats(stats);
        }

        if (initialChatHistoryLengthRef.current === 0) {
          const session = await sessionService.getCurrentSession(orgId);
          if (!cancelled && session) {
            setCurrentSessionId(session.id);
            setChatHistory(session.messages);
            setCurrentSummary(session.summary);
          }
        } else {
        }
      } catch (error) {
        if (!cancelled) {
          console.error('[SessionManager] Failed to initialize:', error);
          if (lastInitializedOrgIdRef.current === orgId) {
            lastInitializedOrgIdRef.current = null;
          }
        }
      }
    };
    
    initialize();
    
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, sessionService]);

  const createNewSession = useCallback(async () => {
    setChatHistory([]);
    setCurrentSessionId(null);
    setCurrentSummary(undefined);
    try {
      await sessionService.clearActiveSession(orgId);
    } catch (error) {
      console.error('[SessionManager] Failed to clear active session:', error);
    }
  }, [sessionService, orgId, setChatHistory]);

  const loadSession = useCallback(
    async (sessionId: string) => {
      try {
        const session = await sessionService.getSession(orgId, sessionId);
        if (session) {
          setCurrentSessionId(session.id);
          setChatHistory(session.messages);
          setCurrentSummary(session.summary);
          await sessionService.setActiveSession(orgId, session.id);
        } else {
          console.error(`[SessionManager] Session ${sessionId} not found`);
        }
      } catch (error) {
        console.error(`[SessionManager] Error loading session:`, error);
      }
    },
    [sessionService, orgId, setChatHistory]
  );

  const deleteSession = useCallback(
    async (sessionId: string) => {
      try {
        await sessionService.deleteSession(orgId, sessionId);
        await refreshSessions();

        if (sessionId === currentSessionId) {
          await createNewSession();
        }

      } catch (error) {
        console.error('[SessionManager] Error deleting session:', error);
      }
    },
    [sessionService, orgId, currentSessionId, createNewSession, refreshSessions]
  );

  const deleteAllSessions = useCallback(async () => {
    try {
      await sessionService.deleteAllSessions(orgId);
      await refreshSessions();
      await createNewSession();
    } catch (error) {
      console.error('[SessionManager] Error deleting all sessions:', error);
    }
  }, [sessionService, orgId, createNewSession, refreshSessions]);


  const saveImmediately = useCallback(
    async (messages: ChatMessage[], titleOverride?: string) => {
      if (readOnly) {
        return;
      }

      if (messages.length === 0) {
        return;
      }

      if (isSavingRef.current) {
        return;
      }

      isSavingRef.current = true;

      try {
        const sessionIdAtStart = currentSessionId;

        if (sessionIdAtStart) {
          await sessionService.updateSession(orgId, sessionIdAtStart, messages, currentSummary);
        } else if (messages.length > 0) {
          const newSession = await sessionService.createSession(orgId, messages, titleOverride);
          setCurrentSessionId((prevId) => {
            if (prevId === null) {
              return newSession.id;
            }
            return prevId;
          });
        }
        await refreshSessions();
      } catch (error) {
        console.error('[SessionManager] Immediate save failed:', error);
      } finally {
        isSavingRef.current = false;
      }
    },
    [sessionService, orgId, currentSessionId, currentSummary, refreshSessions, readOnly]
  );

  const triggerSummarization = useCallback(
    async (messages: ChatMessage[]) => {
      if (isSummarizing || messages.length < 20) {
        return;
      }

      setIsSummarizing(true);

      try {
        const messagesToSummarize = currentSummary ? messages.slice(0, -10) : messages.slice(0, -5);

        if (messagesToSummarize.length > 0) {
          const summary = await ConversationMemoryService.summarizeMessages(messagesToSummarize);
          setCurrentSummary(summary);

          if (currentSessionId) {
            await sessionService.updateSession(orgId, currentSessionId, messages, summary);
          }
        }
      } catch (error) {
        console.error('[SessionManager] Summarization failed:', error);
      } finally {
        setIsSummarizing(false);
      }
    },
    [sessionService, orgId, currentSessionId, currentSummary, isSummarizing]
  );

  useEffect(() => {
    if (readOnly) {
      return;
    }

    if (chatHistory.length > 0) {
      if (ConversationMemoryService.shouldSummarize(chatHistory.length)) {
        triggerSummarization(chatHistory);
      }
    }
  }, [chatHistory, triggerSummarization, readOnly]);

  return {
    currentSessionId,
    sessions,
    currentSummary,
    createNewSession,
    loadSession,
    deleteSession,
    deleteAllSessions,
    saveImmediately,
    refreshSessions,
    loadCurrentSessionIfNeeded,
    triggerSummarization,
    isSummarizing,
    storageStats,
  };
};
