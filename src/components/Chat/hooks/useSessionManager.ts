import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
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
  createNewSession: () => void;
  loadSession: (sessionId: string) => void;
  deleteSession: (sessionId: string) => void;
  deleteAllSessions: () => void;
  exportSession: (sessionId: string) => void;
  importSession: (jsonData: string) => boolean;

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
  // Get session service instance (memoized)
  const sessionService = useMemo(() => ServiceFactory.getSessionService(), []);

  // State
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionMetadata[]>([]);
  const [currentSummary, setCurrentSummary] = useState<string | undefined>(undefined);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [storageStats, setStorageStats] = useState(() => sessionService.getStorageStats(orgId));

  // Auto-save debounce timer
  const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null);

  /**
   * Refresh the sessions list
   */
  const refreshSessions = useCallback(() => {
    const loadedSessions = sessionService.getAllSessions(orgId);
    setSessions(loadedSessions);
    setStorageStats(sessionService.getStorageStats(orgId));
  }, [sessionService, orgId]);

  /**
   * Load the current session on mount
   */
  const loadCurrentSession = useCallback(() => {
    const session = sessionService.getCurrentSession(orgId);
    if (session) {
      setCurrentSessionId(session.id);
      setChatHistory(session.messages);
      setCurrentSummary(session.summary);
      console.log(`[SessionManager] Loaded session: ${session.title} (${session.messages.length} messages)`);
    }
  }, [sessionService, orgId, setChatHistory]);

  /**
   * Load sessions index on mount
   */
  useEffect(() => {
    refreshSessions();
    loadCurrentSession();
  }, [refreshSessions, loadCurrentSession]);

  /**
   * Create a new session
   */
  const createNewSession = useCallback(() => {
    setChatHistory([]);
    setCurrentSessionId(null);
    setCurrentSummary(undefined);
    sessionService.clearActiveSession(orgId);
    console.log('[SessionManager] Created new session');
  }, [sessionService, orgId, setChatHistory]);

  /**
   * Load an existing session
   */
  const loadSession = useCallback(
    (sessionId: string) => {
      try {
        const session = sessionService.getSession(orgId, sessionId);
        if (session) {
          setCurrentSessionId(session.id);
          setChatHistory(session.messages);
          setCurrentSummary(session.summary);
          sessionService.setActiveSession(orgId, session.id);
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
    (sessionId: string) => {
      try {
        sessionService.deleteSession(orgId, sessionId);
        refreshSessions();

        // If deleting current session, clear it
        if (sessionId === currentSessionId) {
          createNewSession();
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
  const deleteAllSessions = useCallback(() => {
    try {
      sessionService.deleteAllSessions(orgId);
      refreshSessions();
      createNewSession();
      console.log('[SessionManager] Deleted all sessions');
    } catch (error) {
      console.error('[SessionManager] Error deleting all sessions:', error);
    }
  }, [sessionService, orgId, createNewSession, refreshSessions]);

  /**
   * Export a session as JSON
   */
  const exportSession = useCallback(
    (sessionId: string) => {
      try {
        const jsonData = sessionService.exportSession(orgId, sessionId);
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
    (jsonData: string): boolean => {
      try {
        const session = sessionService.importSession(orgId, jsonData);
        refreshSessions();
        loadSession(session.id);
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
      autoSaveTimerRef.current = setTimeout(() => {
        try {
          if (currentSessionId) {
            sessionService.updateSession(orgId, currentSessionId, messages, currentSummary);
            console.log(`[SessionManager] Auto-saved session: ${currentSessionId}`);
          } else if (messages.length > 0) {
            const newSession = sessionService.createSession(orgId, messages);
            setCurrentSessionId(newSession.id);
            console.log(`[SessionManager] Created and saved new session: ${newSession.id}`);
          }
          refreshSessions();
        } catch (error) {
          console.error('[SessionManager] Auto-save failed:', error);
        }
      }, 2000);
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
            sessionService.updateSession(orgId, currentSessionId, messages, summary);
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
