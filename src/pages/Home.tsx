import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { Alert, Button, Spinner } from '@grafana/ui';
import { testIds } from '../components/testIds';
import { Chat } from '../components/Chat';
import { useAlertInvestigation } from '../hooks/useAlertInvestigation';
import { useSessionUrl } from '../hooks/useSessionUrl';
import { confirmSlackLink, unlinkSlackAccount, type SlackLinkResult } from '../services/slackLink';
import type { AppPluginSettings } from '../types/plugin';

interface HomeProps {
  pluginSettings: AppPluginSettings;
}

const CONTAINER_STYLE = { height: '100%', maxHeight: '100vh' };

function Home({ pluginSettings }: HomeProps): React.ReactElement {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const investigation = useAlertInvestigation();
  const { sessionIdFromUrl, updateUrlWithSession, clearUrlSession, isValidated } = useSessionUrl();
  const [slackLinkBanner, setSlackLinkBanner] = useState<'idle' | SlackLinkResult>('idle');
  const [slackLinkOrgHint, setSlackLinkOrgHint] = useState<string | undefined>(undefined);
  const [unlinking, setUnlinking] = useState(false);
  const slackLinkDone = useRef(false);

  useEffect(() => {
    const nonce = searchParams.get('slack_link');
    if (!nonce || slackLinkDone.current || !isValidated) {
      return;
    }
    slackLinkDone.current = true;
    // Capture org hint before clearing URL — searchParams will be stale after setSearchParams.
    const capturedOrgHint = searchParams.get('org') ?? undefined;
    void (async () => {
      const next = new URLSearchParams(searchParams);
      next.delete('slack_link');
      next.delete('org');
      setSearchParams(next, { replace: true });
      const result = await confirmSlackLink(nonce);
      setSlackLinkOrgHint(capturedOrgHint);
      setSlackLinkBanner(result);
    })();
  }, [isValidated, searchParams, setSearchParams]);

  const handleDisconnectSlack = useCallback(async () => {
    setUnlinking(true);
    const ok = await unlinkSlackAccount();
    setUnlinking(false);
    setSlackLinkBanner(ok ? 'idle' : 'error');
  }, []);

  const handleStartNormalChat = useCallback(() => {
    navigate(location.pathname, { replace: true });
  }, [navigate, location.pathname]);

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
      {slackLinkBanner === 'linked' && (
        <div className="p-2 shrink-0">
          <Alert title="Slack linked" severity="success">
            <div className="flex items-center justify-between gap-2">
              <span>Your Slack account is connected. You can return to Slack and mention the bot.</span>
              <Button variant="destructive" size="sm" disabled={unlinking} onClick={handleDisconnectSlack}>
                {unlinking ? 'Disconnecting…' : 'Disconnect Slack'}
              </Button>
            </div>
          </Alert>
        </div>
      )}
      {slackLinkBanner === 'expired' && (
        <div className="p-2 shrink-0">
          <Alert title="Slack link expired" severity="warning">
            This link has expired. DM <code>setup</code> to the bot in Slack to get a fresh link.
          </Alert>
        </div>
      )}
      {slackLinkBanner === 'unauthorized' && (
        <div className="p-2 shrink-0">
          <Alert title="Not signed in" severity="error">
            Sign into Grafana{slackLinkOrgHint ? ` (org: ${slackLinkOrgHint})` : ''} first, then open the Slack link again.
          </Alert>
        </div>
      )}
      {slackLinkBanner === 'error' && (
        <div className="p-2 shrink-0">
          <Alert title="Slack link failed" severity="error">
            Something went wrong. Check Grafana logs or run <code>setup</code> again in Slack.
          </Alert>
        </div>
      )}
      <div className="flex-1 flex flex-col min-h-0">
        <Chat
          pluginSettings={pluginSettings}
          initialMessage={investigation.initialMessage ?? undefined}
          initialMessageType={investigation.initialMessageType ?? undefined}
          sessionIdFromUrl={sessionIdFromUrl}
          onSessionIdChange={handleSessionIdChange}
        />
      </div>
    </div>
  );
}

export default Home;
