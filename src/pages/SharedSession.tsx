import React, { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Alert, Button } from '@grafana/ui';
import { sessionShareService, SharedSession as SharedSessionType } from '../services/sessionShare';
import { Chat } from '../components/Chat';
import { ServiceFactory } from '../core/services/ServiceFactory';
import { usePluginUserStorage, config } from '@grafana/runtime';
import { ChatSession } from '../core/models/ChatSession';
import { ChatMessage } from '../components/Chat/types';
import type { AppPluginSettings } from '../types/plugin';
import { normalizeMessageTimestamp } from '../utils/shareUtils';

const EMPTY_PLUGIN_SETTINGS: AppPluginSettings = {};
const NAVIGATION_DELAY_MS = 300;

function convertToMessages(sharedMessages: SharedSessionType['messages']): ChatMessage[] {
  return sharedMessages.map((msg) => ({
    ...msg,
    timestamp: normalizeMessageTimestamp(msg),
  }));
}

function getErrorMessage(err: unknown): string {
  const error = err as { status?: number; response?: { status?: number }; data?: { status?: number; message?: string }; message?: string; statusText?: string };
  const status = error?.status ?? error?.response?.status ?? error?.data?.status;
  const message = (error?.message ?? error?.data?.message ?? error?.statusText ?? '').toLowerCase();

  if (status === 404 || message.includes('not found') || message.includes('expired')) {
    return 'This share link is not found or has expired.';
  }
  if (status === 403 || message.includes('access') || message.includes('permission')) {
    return "You don't have access to this shared session. It may be from a different organization.";
  }
  return 'Failed to load shared session. Please try again later.';
}

function getBasePath(): string {
  const currentPath = window.location.pathname;
  if (currentPath.includes('/shared/')) {
    return currentPath.split('/shared/')[0];
  }
  return currentPath.replace(/\/shared\/.*$/, '');
}

function noop(): void {}

export function SharedSession(): React.ReactElement {
  const { shareId } = useParams<{ shareId: string }>();
  const navigate = useNavigate();
  const storage = usePluginUserStorage();
  const orgId = String(config.bootData.user.orgId || '1');
  const [sharedSession, setSharedSession] = useState<SharedSessionType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    if (!shareId) {
      setError('Share ID is required');
      setLoading(false);
      return;
    }

    async function loadSharedSession(): Promise<void> {
      try {
        const session = await sessionShareService.getSharedSession(shareId!);

        if (!session.messages || session.messages.length === 0) {
          console.error('[SharedSession] Shared session has no messages');
          setError('This shared session has no messages.');
          return;
        }

        setSharedSession(session);
      } catch (err) {
        console.error('[SharedSession] Failed to load shared session:', err);
        setError(getErrorMessage(err));
      } finally {
        setLoading(false);
      }
    }

    loadSharedSession();
  }, [shareId]);

  const handleImport = async (): Promise<void> => {
    if (!sharedSession) {
      return;
    }

    setImporting(true);
    try {
      const sessionService = ServiceFactory.getSessionService(storage);
      const messages = convertToMessages(sharedSession.messages);
      const newSession = await sessionService.createSession(orgId, messages, sharedSession.title);

      await new Promise((resolve) => setTimeout(resolve, NAVIGATION_DELAY_MS));

      const basePath = getBasePath();
      window.location.href = `${window.location.origin}${basePath || '/'}?sessionId=${newSession.id}`;
    } catch (err) {
      console.error('[SharedSession] Failed to import session:', err);
      alert('Failed to import session. Please try again.');
    } finally {
      setImporting(false);
    }
  };

  const session = useMemo(() => {
    if (!sharedSession) {
      return null;
    }
    const messages = convertToMessages(sharedSession.messages);
    return ChatSession.fromStorage({
      id: sharedSession.id,
      title: sharedSession.title || 'Shared Session',
      messages,
      createdAt: sharedSession.createdAt,
      updatedAt: sharedSession.updatedAt,
      messageCount: messages.length,
    });
  }, [sharedSession]);

  if (loading) {
    return (
      <div className="min-h-full w-full flex items-center justify-center">
        <div className="text-center">
          <p>Loading shared session...</p>
        </div>
      </div>
    );
  }

  if (error || !session) {
    return (
      <div className="min-h-full w-full flex items-center justify-center p-4">
        <div className="max-w-md w-full">
          <Alert title="Error" severity="error">
            {error || 'Failed to load shared session'}
          </Alert>
          <div className="mt-4">
            <Button variant="primary" onClick={() => navigate('/')}>
              Go to Home
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full w-full flex flex-col">
      <div className="bg-primary/10 border-b border-primary/20 px-3 py-2 flex-shrink-0 flex-grow-0">
        <div className="flex items-center justify-between gap-4 max-w-full">
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold text-primary truncate">Viewing Shared Session</h2>
            <p className="text-xs text-secondary mt-0.5 truncate">
              This is a shared session. You can view it or import it to your account.
            </p>
          </div>
          <div className="flex-shrink-0">
            <Button variant="primary" size="sm" onClick={handleImport} disabled={importing}>
              {importing ? 'Importing...' : 'Import as New Session'}
            </Button>
          </div>
        </div>
      </div>
      <div className="flex-1 flex flex-col min-h-0">
        <Chat
          pluginSettings={EMPTY_PLUGIN_SETTINGS}
          readOnly={true}
          initialSession={session}
          sessionIdFromUrl={null}
          onSessionIdChange={noop}
        />
      </div>
    </div>
  );
}

export default SharedSession;
