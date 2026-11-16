import { useState, useEffect, useCallback, useRef } from 'react';
import { locationService } from '@grafana/runtime';
import { getSession } from '../services/backendSessionClient';

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

/**
 * Rewrites the sessionId query parameter without leaving the current route.
 * The URL comes from locationService, because the catalog code rules reject
 * direct window.location access.
 */
function replaceSessionParam(value: string | null): void {
  const location = locationService.getLocation();
  const params = new URLSearchParams(location.search ?? '');
  if (value === null) {
    params.delete('sessionId');
  } else {
    params.set('sessionId', value);
  }
  const query = params.toString();
  locationService.replace(`${location.pathname}${query ? `?${query}` : ''}${location.hash ?? ''}`);
}

function removeSessionFromUrl(): void {
  replaceSessionParam(null);
}

export function useSessionUrl(): UseSessionUrlReturn {
  const [sessionIdFromUrl, setSessionIdFromUrl] = useState<string | null>(null);
  const [isValidated, setIsValidated] = useState(false);
  const hasValidatedRef = useRef(false);

  useEffect(() => {
    if (hasValidatedRef.current) {
      return;
    }
    hasValidatedRef.current = true;

    const urlSessionId = new URLSearchParams(locationService.getSearch()).get('sessionId');

    if (!urlSessionId) {
      setIsValidated(true);
      return;
    }

    if (!isValidSessionId(urlSessionId)) {
      removeSessionFromUrl();
      setIsValidated(true);
      return;
    }

    getSession(urlSessionId)
      .then(() => {
        setSessionIdFromUrl(urlSessionId);
        setIsValidated(true);
      })
      .catch(() => {
        removeSessionFromUrl();
        setIsValidated(true);
      });
  }, []);

  const updateUrlWithSession = useCallback((sessionId: string) => {
    if (!isValidSessionId(sessionId)) {
      return;
    }
    replaceSessionParam(sessionId);
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
