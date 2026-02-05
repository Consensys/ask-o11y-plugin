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

const CONTAINER_STYLE = { height: '100%', maxHeight: '100vh' };

function handleStartNormalChat(): void {
  window.history.replaceState({}, '', window.location.pathname);
  window.location.reload();
}

function LoadingSpinner(): React.ReactElement {
  return (
    <div className="w-full h-full flex items-center justify-center">
      <Spinner size="sm" />
    </div>
  );
}

interface InvestigationLoadingProps {
  testId: string;
}

function InvestigationLoading({ testId }: InvestigationLoadingProps): React.ReactElement {
  return (
    <div
      data-testid={testId}
      className="w-full h-full flex items-center justify-center"
      style={CONTAINER_STYLE}
    >
      <div className="text-center">
        <Spinner size="lg" />
        <p className="mt-4 text-secondary">Loading alert investigation...</p>
      </div>
    </div>
  );
}

interface InvestigationErrorProps {
  testId: string;
  error: string;
  pluginSettings: AppPluginSettings;
  onSessionIdChange: (sessionId: string | null) => void;
}

function InvestigationError({
  testId,
  error,
  pluginSettings,
  onSessionIdChange,
}: InvestigationErrorProps): React.ReactElement {
  return (
    <div data-testid={testId} className="w-full flex flex-col overflow-hidden" style={CONTAINER_STYLE}>
      <div className="p-4">
        <Alert title="Investigation Error" severity="error">
          <p>{error}</p>
        </Alert>
        <div className="mt-3">
          <Button variant="secondary" size="sm" onClick={handleStartNormalChat}>
            Start Normal Chat
          </Button>
        </div>
      </div>
      <div className="flex-1 flex flex-col min-h-0">
        <Chat pluginSettings={pluginSettings} sessionIdFromUrl={null} onSessionIdChange={onSessionIdChange} />
      </div>
    </div>
  );
}

function Home({ pluginSettings }: HomeProps): React.ReactElement {
  const investigation = useAlertInvestigation();
  const { sessionIdFromUrl, updateUrlWithSession, clearUrlSession, isValidated } = useSessionUrl();
  const hasSetInvestigationSessionRef = useRef(false);

  const effectiveSessionId =
    investigation.isInvestigationMode && investigation.sessionId ? investigation.sessionId : sessionIdFromUrl;

  useEffect(() => {
    const { isInvestigationMode, sessionId } = investigation;
    const shouldSetInvestigationSession =
      isInvestigationMode && sessionId && !sessionIdFromUrl && !hasSetInvestigationSessionRef.current;

    if (shouldSetInvestigationSession) {
      hasSetInvestigationSessionRef.current = true;
      updateUrlWithSession(sessionId);
    }
  }, [investigation, sessionIdFromUrl, updateUrlWithSession]);

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
    return <LoadingSpinner />;
  }

  if (investigation.isInvestigationMode && investigation.isLoading) {
    return <InvestigationLoading testId={testIds.investigation.loading} />;
  }

  if (investigation.isInvestigationMode && investigation.error) {
    return (
      <InvestigationError
        testId={testIds.investigation.error}
        error={investigation.error}
        pluginSettings={pluginSettings}
        onSessionIdChange={handleSessionIdChange}
      />
    );
  }

  return (
    <div data-testid={testIds.home.container} className="w-full flex flex-col overflow-hidden" style={CONTAINER_STYLE}>
      <div className="flex-1 flex flex-col min-h-0">
        <Chat
          pluginSettings={pluginSettings}
          initialMessage={investigation.initialMessage ?? undefined}
          sessionTitleOverride={investigation.sessionTitle ?? undefined}
          sessionIdFromUrl={effectiveSessionId}
          onSessionIdChange={handleSessionIdChange}
        />
      </div>
    </div>
  );
}

export default Home;
