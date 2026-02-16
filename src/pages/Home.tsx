import React, { useCallback } from 'react';
import { Alert, Button, Spinner } from '@grafana/ui';
import { testIds } from '../components/testIds';
import { Chat } from '../components/Chat';
import { useAlertInvestigation } from '../hooks/useAlertInvestigation';
import { useSessionUrl } from '../hooks/useSessionUrl';
import type { AppPluginSettings } from '../types/plugin';

interface HomeProps {
  pluginSettings: AppPluginSettings;
}

const CONTAINER_STYLE = { height: '100%', maxHeight: '100vh' };

function handleStartNormalChat(): void {
  window.history.replaceState({}, '', window.location.pathname);
  window.location.reload();
}

function Home({ pluginSettings }: HomeProps): React.ReactElement {
  const investigation = useAlertInvestigation();
  const { sessionIdFromUrl, updateUrlWithSession, clearUrlSession, isValidated } = useSessionUrl();

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

  if (investigation.isInvestigationMode && investigation.error) {
    return (
      <div data-testid={testIds.investigation.error} className="w-full flex flex-col overflow-hidden" style={CONTAINER_STYLE}>
        <div className="p-4">
          <Alert title="Investigation Error" severity="error">
            <p>{investigation.error}</p>
          </Alert>
          <div className="mt-3">
            <Button variant="secondary" size="sm" onClick={handleStartNormalChat}>
              Start Normal Chat
            </Button>
          </div>
        </div>
        <div className="flex-1 flex flex-col min-h-0">
          <Chat pluginSettings={pluginSettings} sessionIdFromUrl={null} onSessionIdChange={handleSessionIdChange} />
        </div>
      </div>
    );
  }

  return (
    <div data-testid={testIds.home.container} className="w-full flex flex-col overflow-hidden" style={CONTAINER_STYLE}>
      <div className="flex-1 flex flex-col min-h-0">
        <Chat
          pluginSettings={pluginSettings}
          initialMessage={investigation.initialMessage ?? undefined}
          initialMessageType={investigation.initialMessageType ?? undefined}
          sessionTitleOverride={investigation.sessionTitle ?? undefined}
          sessionIdFromUrl={sessionIdFromUrl}
          onSessionIdChange={handleSessionIdChange}
        />
      </div>
    </div>
  );
}

export default Home;
