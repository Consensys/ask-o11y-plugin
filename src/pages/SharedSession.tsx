import React, { useEffect, useState } from 'react';
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

function normalizeMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((msg) => ({
    ...msg,
    timestamp: normalizeMessageTimestamp({ timestamp: msg.timestamp }),
  }));
}

export function SharedSession() {
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

    const loadSharedSession = async () => {
      try {
        const session = await sessionShareService.getSharedSession(shareId);
        console.log('[SharedSession] Loaded shared session', { 
          id: session.id, 
          title: session.title,
          messageCount: session.messages?.length || 0 
        });
        
        // Validate that we have messages
        if (!session.messages || session.messages.length === 0) {
          console.error('[SharedSession] Shared session has no messages');
          setError('This shared session has no messages.');
          setLoading(false);
          return;
        }
        
        setSharedSession(session);
      } catch (err: unknown) {
        console.error('[SharedSession] Failed to load shared session:', err);
        const errorObj = err as { status?: number; response?: { status?: number }; data?: { status?: number; message?: string }; message?: string; statusText?: string };
        const status = errorObj?.status || errorObj?.response?.status || errorObj?.data?.status;
        const message = (errorObj?.message || errorObj?.data?.message || errorObj?.statusText || '').toLowerCase();

        if (status === 404 || message.includes('not found') || message.includes('expired')) {
          setError('This share link is not found or has expired.');
        } else if (status === 403 || message.includes('access') || message.includes('permission')) {
          setError("You don't have access to this shared session. It may be from a different organization.");
        } else {
          setError('Failed to load shared session. Please try again later.');
        }
      } finally {
        setLoading(false);
      }
    };

    loadSharedSession();
  }, [shareId]);

  const handleImport = async () => {
    if (!sharedSession) {
      return;
    }

    setImporting(true);
    try {
      const sessionService = ServiceFactory.getSessionService(storage);
      const messages = normalizeMessages(sharedSession.messages);

      // Create new session with imported data
      // createSession already sets it as the active session
      await sessionService.createSession(orgId, messages, sharedSession.title);

      // Wait a moment to ensure the session is fully persisted and indexed
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Navigate to home - the session is already set as active
      // When Home component mounts, useSessionManager will initialize and load the current session
      // Use window.location to ensure a fresh mount, which will trigger useSessionManager to load the current session
      const currentPath = window.location.pathname;
      const basePath = currentPath.includes('/shared/') 
        ? currentPath.split('/shared/')[0] 
        : currentPath.replace(/\/shared\/.*$/, '');
      window.location.href = window.location.origin + (basePath || '/');
    } catch (err) {
      console.error('[SharedSession] Failed to import session:', err);
      alert('Failed to import session. Please try again.');
    } finally {
      setImporting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-full w-full flex items-center justify-center">
        <div className="text-center">
          <p>Loading shared session...</p>
        </div>
      </div>
    );
  }

  if (error || !sharedSession) {
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

  // Convert shared session to ChatSession for display
  const messages = normalizeMessages(sharedSession.messages || []);

  console.log('[SharedSession] Rendering with messages', {
    messageCount: messages.length,
    sessionId: sharedSession.id,
    firstMessage: messages[0]?.content?.substring(0, 50)
  });

  const session = ChatSession.fromStorage({
    id: sharedSession.id,
    title: sharedSession.title || 'Shared Session',
    messages: messages,
    createdAt: sharedSession.createdAt,
    updatedAt: sharedSession.updatedAt,
    messageCount: messages.length,
  });

  console.log('[SharedSession] Created session object', {
    sessionId: session.id,
    messageCount: session.messages.length,
    hasInitialSession: true
  });

  // Empty plugin settings for read-only mode
  const emptyPluginSettings: AppPluginSettings = {};

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
        <Chat pluginSettings={emptyPluginSettings} readOnly={true} initialSession={session} />
      </div>
    </div>
  );
}

export default SharedSession;
