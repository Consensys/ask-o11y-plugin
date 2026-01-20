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
  exportSession: (sessionId: string) => Promise<void>;
  importSession: (jsonData: string) => Promise<boolean>;

  // Auto-save
  autoSaveMessages: (messages: ChatMessage[]) => void;

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
  setChatHistory: React.Dispatch<React.SetStateAction<ChatMessage[]>>
): UseSessionManagerReturn => {
  // Get Grafana user storage (automatically falls back to localStorage when user is not signed in)
  const storage = usePluginUserStorage();

  // Get session service instance (memoized with storage dependency)
  const sessionService = useMemo(() => ServiceFactory.getSessionService(storage), [storage]);

  // State
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionMetadata[]>([]);
  const [currentSummary, setCurrentSummary] = useState<string | undefined>(undefined);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [storageStats, setStorageStats] = useState({ used: 0, total: 0, sessionCount: 0 });

  // Auto-save debounce timer
  const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null);

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
   * Load sessions index on mount
   * Skip loading current session if chatHistory already has messages (read-only mode with initialSession)
   */
  useEffect(() => {
    console.log('[SessionManager] Initializing with orgId:', orgId);
    console.log('[SessionManager] Using Grafana user storage (falls back to localStorage if not signed in)');
    
    let cancelled = false;
    
    const initialize = async () => {
      try {
        const loadedSessions = await sessionService.getAllSessions(orgId);
        if (!cancelled) {
          setSessions(loadedSessions);
        }
        
        const stats = await sessionService.getStorageStats(orgId);
        if (!cancelled) {
          setStorageStats(stats);
        }
        
        // Only load current session from storage if chatHistory is empty
        // If chatHistory has messages, we're in read-only mode with an initialSession
        if (chatHistory.length === 0) {
          const session = await sessionService.getCurrentSession(orgId);
          if (!cancelled && session) {
            setCurrentSessionId(session.id);
            setChatHistory(session.messages);
            setCurrentSummary(session.summary);
            console.log(`[SessionManager] Loaded session: ${session.title} (${session.messages.length} messages)`);
          }
        } else {
          console.log('[SessionManager] Skipping session load - chatHistory already has messages (read-only mode)');
        }
      } catch (error) {
        if (!cancelled) {
          console.error('[SessionManager] Failed to initialize:', error);
        }
      }
    };
    
    initialize();
    
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]); // Only depend on orgId to avoid infinite loops


  /**
   * Create a new session
   */
  const createNewSession = useCallback(async () => {
    setChatHistory([]);
    setCurrentSessionId(null);
    setCurrentSummary(undefined);
    try {
      await sessionService.clearActiveSession(orgId);
      console.log('[SessionManager] Created new session');
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
          console.log(`[SessionManager] Loaded session: ${session.title} (${session.messages.length} messages)`);
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

        console.log(`[SessionManager] Deleted session: ${sessionId}`);
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
      console.log('[SessionManager] Deleted all sessions');
    } catch (error) {
      console.error('[SessionManager] Error deleting all sessions:', error);
    }
  }, [sessionService, orgId, createNewSession, refreshSessions]);

  /**
   * Export a session as JSON
   */
  const exportSession = useCallback(
    async (sessionId: string) => {
      try {
        const jsonData = await sessionService.exportSession(orgId, sessionId);
        if (jsonData) {
          // Download as file
          const blob = new Blob([jsonData], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `chat-session-${sessionId}-${Date.now()}.json`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          console.log(`[SessionManager] Exported session: ${sessionId}`);
        }
      } catch (error) {
        console.error('[SessionManager] Error exporting session:', error);
      }
    },
    [sessionService, orgId]
  );

  /**
   * Import a session from JSON
   */
  const importSession = useCallback(
    async (jsonData: string): Promise<boolean> => {
      try {
        const session = await sessionService.importSession(orgId, jsonData);
        await refreshSessions();
        await loadSession(session.id);
        console.log(`[SessionManager] Imported session: ${session.title}`);
        return true;
      } catch (error) {
        console.error('[SessionManager] Error importing session:', error);
        return false;
      }
    },
    [sessionService, orgId, loadSession, refreshSessions]
  );

  /**
   * Auto-save messages with debouncing
   */
  const autoSaveMessages = useCallback(
    (messages: ChatMessage[]) => {
      if (messages.length === 0) {
        return;
      }

      // Clear existing timer
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }

      // Set new timer for debounced save
      autoSaveTimerRef.current = setTimeout(async () => {
        try {
          // Capture currentSessionId at the time the callback executes
          const sessionIdAtStart = currentSessionId;
          
          if (sessionIdAtStart) {
            await sessionService.updateSession(orgId, sessionIdAtStart, messages, currentSummary);
            console.log(`[SessionManager] Auto-saved session: ${sessionIdAtStart}`);
          } else if (messages.length > 0) {
            const newSession = await sessionService.createSession(orgId, messages);
            // Only update if currentSessionId is still null (no session was loaded in the meantime)
            setCurrentSessionId((prevId) => {
              if (prevId === null) {
                return newSession.id;
              }
              // Session was loaded while creating, don't overwrite it
              console.log(`[SessionManager] Session ${prevId} was loaded during creation, keeping it instead of ${newSession.id}`);
              return prevId;
            });
            console.log(`[SessionManager] Created and saved new session: ${newSession.id}`);
          }
          await refreshSessions();
        } catch (error) {
          console.error('[SessionManager] Auto-save failed:', error);
        }
      }, 10000);
    },
    [sessionService, orgId, currentSessionId, currentSummary, refreshSessions]
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
      console.log('[SessionManager] Starting conversation summarization...');

      try {
        const messagesToSummarize = currentSummary ? messages.slice(0, -10) : messages.slice(0, -5);

        if (messagesToSummarize.length > 0) {
          const summary = await ConversationMemoryService.summarizeMessages(messagesToSummarize);
          setCurrentSummary(summary);

          // Update session with summary
          if (currentSessionId) {
            await sessionService.updateSession(orgId, currentSessionId, messages, summary);
            console.log('[SessionManager] Summarization complete and saved');
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
   * Auto-save whenever chat history changes
   */
  useEffect(() => {
    if (chatHistory.length > 0) {
      autoSaveMessages(chatHistory);

      // Check if we should summarize
      if (ConversationMemoryService.shouldSummarize(chatHistory.length)) {
        triggerSummarization(chatHistory);
      }
    }
  }, [chatHistory, autoSaveMessages, triggerSummarization]);

  /**
   * Cleanup on unmount
   */
  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, []);

  return {
    currentSessionId,
    sessions,
    currentSummary,
    createNewSession,
    loadSession,
    deleteSession,
    deleteAllSessions,
    exportSession,
    importSession,
    autoSaveMessages,
    triggerSummarization,
    isSummarizing,
    storageStats,
  };
};
