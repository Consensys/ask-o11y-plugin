import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { usePluginUserStorage, config } from '@grafana/runtime';
import { ServiceFactory } from '../core/services/ServiceFactory';

export interface UseSessionUrlReturn {
  sessionIdFromUrl: string | null;
  updateUrlWithSession: (sessionId: string) => void;
  clearUrlSession: () => void;
  isValidated: boolean;
}

const SESSION_ID_PATTERN = /^[a-zA-Z0-9\-_]{1,128}$/;

function isValidSessionId(sessionId: string): boolean {
  return SESSION_ID_PATTERN.test(sessionId);
}

function removeSessionFromUrl(): void {
  const url = new URL(window.location.href);
  url.searchParams.delete('sessionId');
  window.history.replaceState({}, '', url.toString());
}

export function useSessionUrl(): UseSessionUrlReturn {
  const storage = usePluginUserStorage();
  const orgId = String(config.bootData.user.orgId || '1');
  const sessionService = useMemo(() => ServiceFactory.getSessionService(storage), [storage]);

  const [sessionIdFromUrl, setSessionIdFromUrl] = useState<string | null>(null);
  const [isValidated, setIsValidated] = useState(false);
  const hasValidatedRef = useRef(false);

  useEffect(() => {
    if (hasValidatedRef.current) {
      return;
    }
    hasValidatedRef.current = true;

    const urlSessionId = new URLSearchParams(window.location.search).get('sessionId');

    if (!urlSessionId) {
      setIsValidated(true);
      return;
    }

    if (!isValidSessionId(urlSessionId)) {
      console.warn('[useSessionUrl] Invalid sessionId format, cleaning URL');
      removeSessionFromUrl();
      setIsValidated(true);
      return;
    }

    sessionService
      .getSession(orgId, urlSessionId)
      .then((session) => {
        if (session) {
          setSessionIdFromUrl(urlSessionId);
        } else {
          console.warn(`[useSessionUrl] Session ${urlSessionId} not found, cleaning URL`);
          removeSessionFromUrl();
        }
        setIsValidated(true);
      })
      .catch((error) => {
        console.error('[useSessionUrl] Validation error:', error);
        removeSessionFromUrl();
        setIsValidated(true);
      });
  }, [sessionService, orgId]);

  const updateUrlWithSession = useCallback((sessionId: string) => {
    if (!isValidSessionId(sessionId)) {
      console.error('[useSessionUrl] Attempted to set invalid sessionId:', sessionId);
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.set('sessionId', sessionId);
    window.history.replaceState({}, '', url.toString());
    setSessionIdFromUrl(sessionId);
  }, []);

  const clearUrlSession = useCallback(() => {
    removeSessionFromUrl();
    setSessionIdFromUrl(null);
  }, []);

  return {
    sessionIdFromUrl,
    updateUrlWithSession,
    clearUrlSession,
    isValidated,
  };
}
