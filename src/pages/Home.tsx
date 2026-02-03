import React from 'react';
import { Alert, Button, Spinner } from '@grafana/ui';
import { testIds } from '../components/testIds';
import { Chat } from '../components/Chat';
import { useAlertInvestigation } from '../hooks/useAlertInvestigation';
import type { AppPluginSettings } from '../types/plugin';

interface HomeProps {
  pluginSettings: AppPluginSettings;
}

function Home({ pluginSettings }: HomeProps) {
  const { isLoading, error, initialMessage, sessionTitle, isInvestigationMode, alertDetails } = useAlertInvestigation();

  // Show loading state while fetching alert for investigation
  if (isInvestigationMode && isLoading) {
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

  // Show error state if alert investigation failed
  if (isInvestigationMode && error) {
    return (
      <div
        data-testid={testIds.investigation.error}
        className="w-full flex flex-col overflow-hidden"
        style={{ height: '100%', maxHeight: '100vh' }}
      >
        <div className="p-4">
          <Alert title="Investigation Error" severity="error">
            <p>{error}</p>
          </Alert>
          <div className="mt-3">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                // Remove query params and reload
                window.history.replaceState({}, '', window.location.pathname);
                window.location.reload();
              }}
            >
              Start Normal Chat
            </Button>
          </div>
        </div>
        <div className="flex-1 flex flex-col min-h-0">
          <Chat pluginSettings={pluginSettings} />
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
      {/* Investigation mode banner */}
      {isInvestigationMode && alertDetails && (
        <div
          data-testid={testIds.investigation.banner}
          className="bg-info/10 border-b border-info/20 px-3 py-2 flex-shrink-0"
        >
          <div className="flex items-center gap-2">
            <span className="text-lg">🔍</span>
            <div className="flex-1 min-w-0">
              <h2 className="text-sm font-semibold text-primary truncate">Alert Investigation</h2>
              <p className="text-xs text-secondary mt-0.5 truncate">
                Analyzing: <span className="font-medium">{alertDetails.title}</span>
                {alertDetails.state && (
                  <span className="ml-2 text-warning">({alertDetails.state})</span>
                )}
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 flex flex-col min-h-0">
        <Chat
          pluginSettings={pluginSettings}
          initialMessage={initialMessage || undefined}
          sessionTitleOverride={sessionTitle || undefined}
        />
      </div>
    </div>
  );
}

export default Home;
