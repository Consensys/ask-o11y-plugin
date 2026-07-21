import { useState, useEffect, useCallback, useRef } from 'react';
import { ChatMessage } from '../types';
import {
  listSessions,
  getSession,
  deleteSession as deleteBackendSession,
  deleteAllSessions as deleteAllBackendSessions,
  setCurrentSessionId,
  type SessionMetadata,
} from '../../../services/backendSessionClient';

export type { SessionMetadata } from '../../../services/backendSessionClient';

export interface UseSessionManagerReturn {
  currentSessionId: string | null;
  sessions: SessionMetadata[];
  setCurrentSessionIdDirect: (sessionId: string) => void;
  createNewSession: () => void;
  loadSession: (sessionId: string) => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;
  deleteAllSessions: () => Promise<void>;
  refreshSessions: () => Promise<void>;
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

  useEffect(() => {
    if (sessionIdFromUrl !== null && sessionIdFromUrl !== currentSessionId) {
      setCurrentSessionId_(sessionIdFromUrl);
    }
  }, [sessionIdFromUrl, currentSessionId]);

  const refreshSessions = useCallback(async () => {
    try {
      const loaded = await listSessions();
      setSessions(loaded);
    } catch {
      // Best-effort refresh — UI stays on stale list
    }
  }, []);

  // On org change: populate the history sidebar. We intentionally do NOT
  // restore the last-active session — opening Ask O11y always starts a fresh
  // chat with past conversations available in the sidebar. URL-driven loading
  // (shared links, alert investigations) is handled separately in useChat.
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
      } catch {
        if (!cancelled && lastInitializedOrgIdRef.current === orgId) {
          lastInitializedOrgIdRef.current = null;
        }
      }
    };

    initialize();

    return () => {
      cancelled = true;
    };
  }, [orgId]);

  const createNewSession = useCallback(async () => {
    setChatHistory([]);
    setCurrentSessionId_(null);
    onSessionIdChange(null);
    try {
      await setCurrentSessionId(null);
    } catch {
      // Best-effort: clearing backend current session is not critical
    }
  }, [setChatHistory, onSessionIdChange]);

  const loadSession = useCallback(
    async (sessionId: string) => {
      try {
        const session = await getSession(sessionId);
        setCurrentSessionId_(session.id);
        setChatHistory(session.messages as ChatMessage[]);
        setSessions((prev) => {
          const metadata = {
            id: session.id,
            title: session.title,
            createdAt: session.createdAt,
            updatedAt: session.updatedAt,
            messageCount: session.messageCount,
            activeRunId: session.activeRunId,
            model: session.model,
          };
          return prev.some((s) => s.id === session.id)
            ? prev.map((s) => (s.id === session.id ? { ...s, ...metadata } : s))
            : [metadata, ...prev];
        });
        onSessionIdChange(session.id);
        await setCurrentSessionId(session.id);
      } catch (error: unknown) {
        const is404 = error instanceof Error && error.message.includes('404');
        if (is404) {
          setCurrentSessionId_(null);
          setChatHistory([]);
          onSessionIdChange(null);
        }
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
          createNewSession();
        }
      } catch {
        // Best-effort delete
      }
    },
    [currentSessionId, createNewSession, refreshSessions]
  );

  const deleteAllSessionsFn = useCallback(async () => {
    try {
      await deleteAllBackendSessions();
      await refreshSessions();
      createNewSession();
    } catch {
      // Best-effort delete all
    }
  }, [createNewSession, refreshSessions]);

  return {
    currentSessionId,
    sessions,
    setCurrentSessionIdDirect: setCurrentSessionId_,
    createNewSession,
    loadSession,
    deleteSession: deleteSessionFn,
    deleteAllSessions: deleteAllSessionsFn,
    refreshSessions,
  };
}
