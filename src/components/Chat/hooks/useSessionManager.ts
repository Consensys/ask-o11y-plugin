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

  // Immediate save
  saveImmediately: (messages: ChatMessage[]) => Promise<void>;

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

/**
 * Refactored hook using clean architecture with Service layer
 * Performance optimized with memoization and proper dependency management
 */
export const useSessionManager = (
  orgId: string,
  chatHistory: ChatMessage[],
  setChatHistory: React.Dispatch<React.SetStateAction<ChatMessage[]>>,
  readOnly?: boolean
): UseSessionManagerReturn => {
  // Get Grafana UserStorage API for persistent per-user storage
  const storage = usePluginUserStorage();

  // Get session service instance (memoized with storage dependency)
  const sessionService = useMemo(() => ServiceFactory.getSessionService(storage), [storage]);

  // State
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionMetadata[]>([]);
  const [currentSummary, setCurrentSummary] = useState<string | undefined>(undefined);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [storageStats, setStorageStats] = useState({ used: 0, total: 0, sessionCount: 0 });

  // Concurrent save protection
  const isSavingRef = useRef(false);
  
  // Track the last orgId we initialized for to prevent re-initialization on chatHistory changes
  const lastInitializedOrgIdRef = useRef<string | null>(null);
  
  // Capture initial chatHistory length to check if we should load current session
  // This avoids including chatHistory in the dependency array which causes re-runs
  // IMPORTANT: Capture the initial length immediately when the hook is called
  // This ensures read-only mode with initialSession is detected correctly
  const initialChatHistoryLengthRef = useRef<number>(chatHistory.length);
  
  // Update the ref when orgId changes to capture the new initial state
  // But preserve the initial value if chatHistory already had messages (read-only mode)
  useEffect(() => {
    // Only update if we haven't captured an initial value with messages yet
    // This prevents overwriting the initial state when orgId changes in read-only mode
    if (initialChatHistoryLengthRef.current === 0 && chatHistory.length > 0) {
      initialChatHistoryLengthRef.current = chatHistory.length;
    } else if (chatHistory.length === 0) {
      // Reset if chatHistory becomes empty (new session)
      initialChatHistoryLengthRef.current = 0;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]); // Only update when orgId changes, not on every chatHistory change

  /**
   * Refresh the sessions list
   */
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
      // Don't load if read-only, has messages, or already has a session ID
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

  /**
   * Load sessions index on mount
   * Skip loading current session if chatHistory already has messages (read-only mode with initialSession)
   */
  useEffect(() => {
    // Only initialize once per orgId, not on every chatHistory change
    // This prevents re-initialization when chatHistory changes after mount
    if (lastInitializedOrgIdRef.current === orgId) {
      return;
    }
    
    
    // Mark this orgId as initialized immediately to prevent race conditions
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
        
        // Only load current session from storage if chatHistory was initially empty
        // If chatHistory had messages initially, we're in read-only mode with an initialSession
        // Use the ref value captured at effect creation time, not the current chatHistory
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
          // Reset the ref on error so we can retry
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
  }, [orgId, sessionService]); // Removed chatHistory and setChatHistory from deps - use ref instead to avoid re-runs


  /**
   * Create a new session
   */
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

  /**
   * Load an existing session
   */
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

  /**
   * Delete a session
   */
  const deleteSession = useCallback(
    async (sessionId: string) => {
      try {
        await sessionService.deleteSession(orgId, sessionId);
        await refreshSessions();

        // If deleting current session, clear it
        if (sessionId === currentSessionId) {
          await createNewSession();
        }

      } catch (error) {
        console.error('[SessionManager] Error deleting session:', error);
      }
    },
    [sessionService, orgId, currentSessionId, createNewSession, refreshSessions]
  );

  /**
   * Delete all sessions
   */
  const deleteAllSessions = useCallback(async () => {
    try {
      await sessionService.deleteAllSessions(orgId);
      await refreshSessions();
      await createNewSession();
    } catch (error) {
      console.error('[SessionManager] Error deleting all sessions:', error);
    }
  }, [sessionService, orgId, createNewSession, refreshSessions]);


  /**
   * Save messages immediately without debouncing
   * Prevents concurrent saves with isSavingRef flag
   * Skips save in read-only mode
   */
  const saveImmediately = useCallback(
    async (messages: ChatMessage[]) => {
      if (readOnly) {
        return;
      }

      if (messages.length === 0) {
        return;
      }

      // Prevent concurrent saves
      if (isSavingRef.current) {
        return;
      }

      isSavingRef.current = true;

      try {
        // Capture currentSessionId at the time the callback executes
        const sessionIdAtStart = currentSessionId;
        
        if (sessionIdAtStart) {
          await sessionService.updateSession(orgId, sessionIdAtStart, messages, currentSummary);
        } else if (messages.length > 0) {
          const newSession = await sessionService.createSession(orgId, messages);
          // Only update if currentSessionId is still null (no session was loaded in the meantime)
          setCurrentSessionId((prevId) => {
            if (prevId === null) {
              return newSession.id;
            }
            // Session was loaded while creating, don't overwrite it
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

  /**
   * Trigger summarization for long conversations
   */
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

          // Update session with summary
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

  /**
   * Trigger summarization when chat history grows
   * Note: We no longer auto-save here - saves are now explicit at key points
   */
  useEffect(() => {
    if (readOnly) {
      return;
    }

    if (chatHistory.length > 0) {
      // Check if we should summarize
      if (ConversationMemoryService.shouldSummarize(chatHistory.length)) {
        triggerSummarization(chatHistory);
      }
    }
  }, [chatHistory, triggerSummarization, readOnly]);

  // Debug: Log sessions state when it changes
  useEffect(() => {
  }, [sessions]);

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
