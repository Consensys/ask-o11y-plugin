import React, { useState, useEffect, useRef } from 'react';
import { UseSessionManagerReturn } from '../../hooks/useSessionManager';
import { SessionMetadata } from '../../../../core';
import { LoadingButton, InlineLoading } from '../../../LoadingOverlay';
import { ShareDialog } from '../ShareDialog/ShareDialog';
import { sessionShareService, CreateShareResponse } from '../../../../services/sessionShare';
import { ServiceFactory } from '../../../../core/services/ServiceFactory';
import { usePluginUserStorage, config } from '@grafana/runtime';
import { Icon, useTheme2 } from '@grafana/ui';

interface SessionSidebarProps {
  sessionManager: UseSessionManagerReturn;
  currentSessionId: string | null;
  isOpen: boolean;
  onClose: () => void;
}

export function SessionSidebar({ sessionManager, currentSessionId, isOpen, onClose }: SessionSidebarProps) {
  const theme = useTheme2();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [creatingSession, setCreatingSession] = useState(false);
  const [shareDialogSessionId, setShareDialogSessionId] = useState<string | null>(null);
  const [sessionShares, setSessionShares] = useState<Map<string, CreateShareResponse[]>>(new Map());
  const previousSessionIdsRef = useRef<string>('');
  const isLoadingRef = useRef<boolean>(false);

  // Create a stable string representation of session IDs for comparison
  const sessionIdsString = sessionManager.sessions.map((s) => s.id).sort().join(',');

  // Refresh sessions and load shares when sidebar opens
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    // Refresh sessions list when sidebar opens to ensure it's up to date
    sessionManager.refreshSessions();

    // Only reload shares if session IDs actually changed and we're not already loading
    if (sessionIdsString === previousSessionIdsRef.current || isLoadingRef.current) {
      return;
    }

    previousSessionIdsRef.current = sessionIdsString;
    isLoadingRef.current = true;

    const loadAllShares = async () => {
      try {
        const sharesMap = new Map<string, CreateShareResponse[]>();
        for (const session of sessionManager.sessions) {
          try {
            const shares = await sessionShareService.getSessionShares(session.id);
            sharesMap.set(session.id, shares);
          } catch (error) {
            console.error(`[SessionSidebar] Failed to load shares for session ${session.id}:`, error);
          }
        }
        setSessionShares(sharesMap);
      } finally {
        isLoadingRef.current = false;
      }
    };
    loadAllShares();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, sessionIdsString]); // sessionIdsString is a stable string value, won't cause infinite loops

  const formatDate = (date: Date) => {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) {
      return 'Today';
    } else if (days === 1) {
      return 'Yesterday';
    } else if (days < 7) {
      return `${days} days ago`;
    } else {
      return date.toLocaleDateString();
    }
  };

  const handleLoadSession = async (sessionId: string) => {
    setLoadingAction(`loading-${sessionId}`);
    try {
      await new Promise((resolve) => setTimeout(resolve, 300)); // Small delay for UX
      await sessionManager.loadSession(sessionId);
      onClose();
    } finally {
      setLoadingAction(null);
    }
  };

  const handleDeleteClick = (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setShowDeleteConfirm(sessionId);
  };

  const confirmDelete = async (sessionId: string) => {
    setLoadingAction(`deleting-${sessionId}`);
    try {
      await new Promise((resolve) => setTimeout(resolve, 300)); // Small delay for UX
      await sessionManager.deleteSession(sessionId);
      setShowDeleteConfirm(null);
    } finally {
      setLoadingAction(null);
    }
  };


  const storagePercent = sessionManager.storageStats.total > 0 
    ? Math.round((sessionManager.storageStats.used / sessionManager.storageStats.total) * 100)
    : 0;

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop - theme-aware overlay */}
      <div 
        className="absolute inset-0" 
        onClick={onClose}
        style={{ 
          backgroundColor: theme.colors.background.canvas,
          opacity: theme.isDark ? 0.9 : 0.8
        }}
      />

      {/* Sidebar */}
      <div 
        className="relative w-80 shadow-xl flex flex-col border-r border-weak"
        style={{ 
          backgroundColor: theme.colors.background.primary
        }}
      >
        {/* Header */}
        <div className="p-2 border-b border-weak">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-base font-semibold text-primary">Chat History</h2>
            <button 
              onClick={onClose} 
              className="p-0.5 hover:bg-secondary rounded text-secondary hover:text-primary transition-colors" 
              title="Close"
            >
              <Icon name="times" size="sm" />
            </button>
          </div>

          {/* Actions */}
          <div className="flex gap-1.5 mt-2">
            <LoadingButton
              onClick={async () => {
                setCreatingSession(true);
                try {
                  await sessionManager.createNewSession();
                  onClose();
                } catch (error) {
                  console.error('[SessionSidebar] Failed to create new session:', error);
                } finally {
                  setCreatingSession(false);
                }
              }}
              isLoading={creatingSession}
              loadingText="Creating..."
              variant="primary"
              size="sm"
              className="w-full"
            >
              + New Chat
            </LoadingButton>
          </div>

          {/* Storage indicator */}
          <div className="mt-2 text-xs text-secondary">
            <div className="flex justify-between mb-1">
              <span>{sessionManager.sessions.length} sessions</span>
              <span>{storagePercent}% storage used</span>
            </div>
            <div className="w-full bg-surface rounded-full h-1">
              <div
                className={`h-1 rounded-full ${storagePercent > 80 ? 'bg-error' : 'bg-primary'}`}
                style={{ width: `${storagePercent}%` }}
              />
            </div>
          </div>
        </div>

        {/* Session list */}
        <div className="flex-1 overflow-y-auto p-1.5">
          {sessionManager.sessions.length === 0 ? (
            <div className="text-center text-secondary mt-8">
              <p className="text-sm">No saved conversations yet</p>
              <p className="text-xs mt-1">Start a new chat to begin</p>
            </div>
          ) : (
            <div className="space-y-0.5">
              {sessionManager.sessions.map((session: SessionMetadata) => (
                <SessionItem
                  key={session.id}
                  session={session}
                  isActive={session.id === currentSessionId}
                  showDeleteConfirm={showDeleteConfirm === session.id}
                  isLoading={loadingAction === `loading-${session.id}`}
                  isDeleting={loadingAction === `deleting-${session.id}`}
                  hasShares={(sessionShares.get(session.id)?.length ?? 0) > 0}
                  onLoad={() => handleLoadSession(session.id)}
                  onDelete={(e) => handleDeleteClick(session.id, e)}
                  onConfirmDelete={() => confirmDelete(session.id)}
                  onCancelDelete={() => setShowDeleteConfirm(null)}
                  onShare={() => setShareDialogSessionId(session.id)}
                  formatDate={formatDate}
                />
              ))}
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="p-2 border-t border-weak">
          {sessionManager.sessions.length > 0 && (
            <button
              onClick={async () => {
                if (confirm('Are you sure you want to delete all conversations? This cannot be undone.')) {
                  try {
                    await sessionManager.deleteAllSessions();
                  } catch (error) {
                    console.error('[SessionSidebar] Failed to delete all sessions:', error);
                  }
                }
              }}
              className="w-full px-2 py-1 text-xs text-error hover:bg-error/10 rounded transition-colors"
            >
              Clear All History
            </button>
          )}
        </div>


        {/* Share dialog */}
        {shareDialogSessionId && (
          <ShareDialogWrapper
            sessionId={shareDialogSessionId}
            onClose={() => setShareDialogSessionId(null)}
            existingShares={sessionShares.get(shareDialogSessionId) || []}
            onSharesChanged={(shares) => {
              setSessionShares((prev) => {
                const next = new Map(prev);
                next.set(shareDialogSessionId, shares);
                return next;
              });
            }}
          />
        )}
      </div>
    </div>
  );
}

// Wrapper component to load session data for ShareDialog
function ShareDialogWrapper({
  sessionId,
  onClose,
  existingShares,
  onSharesChanged,
}: {
  sessionId: string;
  onClose: () => void;
  existingShares: CreateShareResponse[];
  onSharesChanged: (shares: CreateShareResponse[]) => void;
}) {
  const storage = usePluginUserStorage();
  const orgId = String(config.bootData.user.orgId || '1');
  const [session, setSession] = React.useState<any>(null);
  const [loading, setLoading] = React.useState(true);

  useEffect(() => {
    const loadSession = async () => {
      try {
        const sessionService = ServiceFactory.getSessionService(storage);
        const loadedSession = await sessionService.getSession(orgId, sessionId);
        if (loadedSession) {
          setSession(loadedSession);
        }
      } catch (error) {
        console.error('[ShareDialogWrapper] Failed to load session:', error);
      } finally {
        setLoading(false);
      }
    };
    loadSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, orgId]); // storage is stable, don't include it to avoid unnecessary re-runs

  if (loading || !session) {
    return null;
  }

  return (
    <ShareDialog
      sessionId={sessionId}
      session={session}
      onClose={onClose}
      existingShares={existingShares}
      onSharesChanged={onSharesChanged}
    />
  );
}

interface SessionItemProps {
  session: SessionMetadata;
  isActive: boolean;
  showDeleteConfirm: boolean;
  isLoading?: boolean;
  isDeleting?: boolean;
  hasShares?: boolean;
  onLoad: () => void;
  onDelete: (e: React.MouseEvent) => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
  onShare: () => void;
  formatDate: (date: Date) => string;
}

function SessionItem({
  session,
  isActive,
  showDeleteConfirm,
  isLoading = false,
  isDeleting = false,
  hasShares = false,
  onLoad,
  onDelete,
  onConfirmDelete,
  onCancelDelete,
  onShare,
  formatDate,
}: SessionItemProps) {
  if (showDeleteConfirm) {
    return (
      <div className="p-2 bg-surface rounded border border-error">
        <p className="text-xs text-error mb-1.5">Delete this conversation?</p>
        <div className="flex gap-1.5">
          <LoadingButton
            onClick={onConfirmDelete}
            isLoading={isDeleting}
            loadingText="Deleting..."
            variant="destructive"
            size="sm"
            className="flex-1"
          >
            Delete
          </LoadingButton>
          <button
            onClick={onCancelDelete}
            disabled={isDeleting}
            className="flex-1 px-1.5 py-0.5 text-xs bg-secondary hover:bg-surface rounded text-secondary hover:text-primary disabled:opacity-50 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="session-item"
      onClick={isLoading ? undefined : onLoad}
      className={`p-1.5 rounded group transition-colors relative ${
        isActive
          ? 'bg-surface border border-primary'
          : 'hover:bg-secondary border border-weak'
      } ${isLoading ? 'cursor-wait' : 'cursor-pointer'}`}
    >
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-background rounded border border-weak">
          <InlineLoading message="Loading..." size="sm" />
        </div>
      )}

      <div className="flex items-start justify-between gap-1.5">
        <div className="flex-1 min-w-0">
          <h3 className="font-medium text-xs truncate text-primary">{session.title}</h3>
          <div className="flex items-center gap-1.5 mt-0.5 text-xs text-secondary">
            <span>{formatDate(session.updatedAt)}</span>
            <span>•</span>
            <span>{session.messageCount} messages</span>
          </div>
        </div>

        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            data-testid="session-share-button"
            onClick={(e) => {
              e.stopPropagation();
              onShare();
            }}
            disabled={isLoading}
            className="p-0.5 hover:bg-surface rounded text-secondary hover:text-primary disabled:opacity-50 transition-colors"
            title={hasShares ? 'View shares' : 'Share'}
          >
            <Icon name="share-alt" size="sm" />
          </button>
          <button
            data-testid="session-delete-button"
            onClick={onDelete}
            disabled={isLoading}
            className="p-0.5 hover:bg-surface rounded text-error hover:text-error disabled:opacity-50 transition-colors"
            title="Delete"
          >
            <Icon name="trash-alt" size="sm" />
          </button>
        </div>
      </div>
    </div>
  );
}
