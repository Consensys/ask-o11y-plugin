import React, { useCallback, useEffect, useRef } from 'react';
import { Alert, Button, Spinner } from '@grafana/ui';
import { testIds } from '../components/testIds';
import { Chat } from '../components/Chat';
import { useAlertInvestigation } from '../hooks/useAlertInvestigation';
import { useSessionUrl } from '../hooks/useSessionUrl';
import type { AppPluginSettings } from '../types/plugin';

interface HomeProps {
  pluginSettings: AppPluginSettings;
}

function Home({ pluginSettings }: HomeProps) {
  const investigation = useAlertInvestigation();
  const { sessionIdFromUrl, updateUrlWithSession, clearUrlSession, isValidated } = useSessionUrl();
  const hasSetInvestigationSessionRef = useRef(false);

  const effectiveSessionId =
    investigation.isInvestigationMode && investigation.sessionId ? investigation.sessionId : sessionIdFromUrl;

  useEffect(() => {
    if (
      investigation.isInvestigationMode &&
      investigation.sessionId &&
      !sessionIdFromUrl &&
      !hasSetInvestigationSessionRef.current
    ) {
      hasSetInvestigationSessionRef.current = true;
      updateUrlWithSession(investigation.sessionId);
    }
  }, [investigation.isInvestigationMode, investigation.sessionId, sessionIdFromUrl, updateUrlWithSession]);

  const handleSessionIdChange = useCallback(
    (newSessionId: string | null) => {
      if (newSessionId) {
        updateUrlWithSession(newSessionId);
      } else {
        clearUrlSession();
      }
    },
    [updateUrlWithSession, clearUrlSession]
  );

  if (!isValidated) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <Spinner size="sm" />
      </div>
    );
  }

  if (investigation.isInvestigationMode && investigation.isLoading) {
    return (
      <div
        data-testid={testIds.investigation.loading}
        className="w-full h-full flex items-center justify-center"
        style={{ height: '100%', maxHeight: '100vh' }}
      >
        <div className="text-center">
          <Spinner size="lg" />
          <p className="mt-4 text-secondary">Loading alert investigation...</p>
        </div>
      </div>
    );
  }

  if (investigation.isInvestigationMode && investigation.error) {
    return (
      <div
        data-testid={testIds.investigation.error}
        className="w-full flex flex-col overflow-hidden"
        style={{ height: '100%', maxHeight: '100vh' }}
      >
        <div className="p-4">
          <Alert title="Investigation Error" severity="error">
            <p>{investigation.error}</p>
          </Alert>
          <div className="mt-3">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                window.history.replaceState({}, '', window.location.pathname);
                window.location.reload();
              }}
            >
              Start Normal Chat
            </Button>
          </div>
        </div>
        <div className="flex-1 flex flex-col min-h-0">
          <Chat
            pluginSettings={pluginSettings}
            sessionIdFromUrl={null}
            onSessionIdChange={handleSessionIdChange}
          />
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid={testIds.home.container}
      className="w-full flex flex-col overflow-hidden"
      style={{ height: '100%', maxHeight: '100vh' }}
    >
      <div className="flex-1 flex flex-col min-h-0">
        <Chat
          pluginSettings={pluginSettings}
          initialMessage={investigation.initialMessage || undefined}
          sessionTitleOverride={investigation.sessionTitle || undefined}
          sessionIdFromUrl={effectiveSessionId}
          onSessionIdChange={handleSessionIdChange}
        />
      </div>
    </div>
  );
}

export default Home;
