import { useState, useEffect, useCallback, useRef } from 'react';
import { ChatMessage } from '../types';
import {
  listSessions,
  getSession,
  deleteSession as deleteBackendSession,
  deleteAllSessions as deleteAllBackendSessions,
  getCurrentSessionId,
  setCurrentSessionId,
  type SessionMetadata,
} from '../../../services/backendSessionClient';

export type { SessionMetadata } from '../../../services/backendSessionClient';

export interface UseSessionManagerReturn {
  currentSessionId: string | null;
  sessions: SessionMetadata[];
  setCurrentSessionIdDirect: (sessionId: string) => void;
  createNewSession: () => Promise<void>;
  loadSession: (sessionId: string) => Promise<void>;
  loadSessionFromUrl: (sessionId: string) => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;
  deleteAllSessions: () => Promise<void>;
  refreshSessions: () => Promise<void>;
  loadCurrentSessionIfNeeded: () => Promise<void>;
}

export function useSessionManager(
  orgId: string,
  chatHistory: ChatMessage[],
  setChatHistory: React.Dispatch<React.SetStateAction<ChatMessage[]>>,
  sessionIdFromUrl: string | null,
  onSessionIdChange: (sessionId: string | null) => void,
  readOnly?: boolean
): UseSessionManagerReturn {
  const [currentSessionId, setCurrentSessionId_] = useState<string | null>(sessionIdFromUrl);
  const [sessions, setSessions] = useState<SessionMetadata[]>([]);

  const lastInitializedOrgIdRef = useRef<string | null>(null);
  const initialChatHistoryLengthRef = useRef<number>(chatHistory.length);

  useEffect(() => {
    if (chatHistory.length === 0) {
      initialChatHistoryLengthRef.current = 0;
    } else if (initialChatHistoryLengthRef.current === 0) {
      initialChatHistoryLengthRef.current = chatHistory.length;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  useEffect(() => {
    if (sessionIdFromUrl !== null && sessionIdFromUrl !== currentSessionId) {
      setCurrentSessionId_(sessionIdFromUrl);
    }
  }, [sessionIdFromUrl, currentSessionId]);

  const refreshSessions = useCallback(async () => {
    try {
      const loaded = await listSessions();
      setSessions(loaded);
    } catch (error) {
      console.error('[SessionManager] Failed to refresh sessions:', error);
    }
  }, []);

  const loadCurrentSessionIfNeeded = useCallback(async () => {
    if (readOnly || chatHistory.length > 0 || currentSessionId !== null) {
      return;
    }

    try {
      const id = await getCurrentSessionId();
      if (id) {
        const session = await getSession(id);
        setCurrentSessionId_(session.id);
        setChatHistory(session.messages as ChatMessage[]);
      }
    } catch (error) {
      console.error('[SessionManager] Failed to load current session:', error);
    }
  }, [chatHistory.length, currentSessionId, readOnly, setChatHistory]);

  useEffect(() => {
    if (lastInitializedOrgIdRef.current === orgId) {
      return;
    }

    lastInitializedOrgIdRef.current = orgId;

    let cancelled = false;

    const initialize = async () => {
      try {
        const loaded = await listSessions();
        if (!cancelled) {
          setSessions(loaded);
        }

        if (initialChatHistoryLengthRef.current === 0 && !sessionIdFromUrl) {
          const id = await getCurrentSessionId();
          if (!cancelled && id) {
            const session = await getSession(id);
            setCurrentSessionId_(session.id);
            setChatHistory(session.messages as ChatMessage[]);
          }
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
  }, [orgId, sessionIdFromUrl]);

  const createNewSession = useCallback(async () => {
    setChatHistory([]);
    setCurrentSessionId_(null);
    onSessionIdChange(null);
    try {
      await setCurrentSessionId(null);
    } catch (error) {
      console.error('[SessionManager] Failed to clear active session:', error);
    }
  }, [setChatHistory, onSessionIdChange]);

  const loadSession = useCallback(
    async (sessionId: string) => {
      try {
        const session = await getSession(sessionId);
        setCurrentSessionId_(session.id);
        setChatHistory(session.messages as ChatMessage[]);
        onSessionIdChange(session.id);
        await setCurrentSessionId(session.id);
      } catch (error) {
        console.error('[SessionManager] Error loading session:', error);
      }
    },
    [setChatHistory, onSessionIdChange]
  );

  const loadSessionFromUrl = useCallback(
    async (sessionId: string) => {
      try {
        const session = await getSession(sessionId);
        setCurrentSessionId_(session.id);
        setChatHistory(session.messages as ChatMessage[]);
      } catch (error) {
        console.error('[SessionManager] Error loading URL session:', error);
        setCurrentSessionId_(null);
        setChatHistory([]);
        onSessionIdChange(null);
      }
    },
    [setChatHistory, onSessionIdChange]
  );

  const deleteSessionFn = useCallback(
    async (sessionId: string) => {
      try {
        await deleteBackendSession(sessionId);
        await refreshSessions();

        if (sessionId === currentSessionId) {
          await createNewSession();
        }
      } catch (error) {
        console.error('[SessionManager] Error deleting session:', error);
      }
    },
    [currentSessionId, createNewSession, refreshSessions]
  );

  const deleteAllSessionsFn = useCallback(async () => {
    try {
      await deleteAllBackendSessions();
      await refreshSessions();
      await createNewSession();
    } catch (error) {
      console.error('[SessionManager] Error deleting all sessions:', error);
    }
  }, [createNewSession, refreshSessions]);

  return {
    currentSessionId,
    sessions,
    setCurrentSessionIdDirect: setCurrentSessionId_,
    createNewSession,
    loadSession,
    loadSessionFromUrl,
    deleteSession: deleteSessionFn,
    deleteAllSessions: deleteAllSessionsFn,
    refreshSessions,
    loadCurrentSessionIfNeeded,
  };
}
