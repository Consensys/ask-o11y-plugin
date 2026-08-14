import React, { useState, useEffect } from 'react';
import { UseSessionManagerReturn, SessionMetadata } from '../../hooks/useSessionManager';
import { LoadingButton, InlineLoading } from '../../../LoadingOverlay';
import { ShareDialog } from '../ShareDialog/ShareDialog';
import { sessionShareService, CreateShareResponse } from '../../../../services/sessionShare';
import { getSession, getSessionStats, SessionStats } from '../../../../services/backendSessionClient';
import { Icon, useTheme2 } from '@grafana/ui';

interface SessionSidebarProps {
  sessionManager: UseSessionManagerReturn;
  currentSessionId: string | null;
  isOpen: boolean;
  onClose: () => void;
  /** When true, render as a persistent panel docked beside the chat instead of a modal overlay. */
  docked?: boolean;
}

export function SessionSidebar({ sessionManager, currentSessionId, isOpen, onClose, docked = false }: SessionSidebarProps) {
  const theme = useTheme2();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [creatingSession, setCreatingSession] = useState(false);
  const [shareDialogSessionId, setShareDialogSessionId] = useState<string | null>(null);
  const [sessionShares, setSessionShares] = useState<Map<string, CreateShareResponse[]>>(new Map());
  const [sessionStats, setSessionStats] = useState<Map<string, SessionStats>>(new Map());

  // Stable signature that changes when the session set changes OR when any
  // session's updatedAt changes (e.g. a completed run bumps it) — not just
  // on creation/deletion — so shares/stats get refetched instead of going stale.
  const sessionSignature = sessionManager.sessions
    .map((s) => `${s.id}:${new Date(s.updatedAt).getTime()}`)
    .sort()
    .join(',');

  // Refresh sessions and load shares/stats when sidebar opens or sessions change.
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    let cancelled = false;

    const loadSessionExtras = async () => {
      const sessions = await sessionManager.refreshSessions();
      if (cancelled) {
        return;
      }

      const sharesMap = new Map<string, CreateShareResponse[]>();
      const statsMap = new Map<string, SessionStats>();
      for (const session of sessions) {
        try {
          const shares = await sessionShareService.getSessionShares(session.id);
          sharesMap.set(session.id, shares);
        } catch {
          // Best-effort share loading per session
        }
        try {
          const stats = await getSessionStats(session.id);
          statsMap.set(session.id, stats);
        } catch {
          // Best-effort stats loading per session
        }
        if (cancelled) {
          return;
        }
      }
      if (!cancelled) {
        setSessionShares(sharesMap);
        setSessionStats(statsMap);
      }
    };

    loadSessionExtras();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, sessionSignature]); // sessionSignature is a stable string value, won't cause infinite loops

  const formatDate = (date: Date | string) => {
    const d = typeof date === 'string' ? new Date(date) : date;
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) {
      return 'Today';
    } else if (days === 1) {
      return 'Yesterday';
    } else if (days < 7) {
      return `${days} days ago`;
    } else {
      return d.toLocaleDateString();
    }
  };

  const handleLoadSession = async (sessionId: string) => {
    setLoadingAction(`loading-${sessionId}`);
    try {
      await new Promise((resolve) => setTimeout(resolve, 300)); // Small delay for UX
      await sessionManager.loadSession(sessionId);
      if (!docked) {
        onClose();
      }
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

  if (!isOpen) {
    return null;
  }

  return (
    <div className={docked ? 'flex h-full' : 'fixed inset-0 z-50 flex'}>
      {/* Backdrop - theme-aware overlay (modal mode only) */}
      {!docked && (
        <div
          className="absolute inset-0"
          onClick={onClose}
          style={{
            backgroundColor: theme.colors.background.canvas,
            opacity: theme.isDark ? 0.9 : 0.8,
          }}
        />
      )}

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
                  if (!docked) {
                    onClose();
                  }
                } catch {
                  // Session creation is best-effort; UI resets on next interaction
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

          <div className="mt-2 text-xs text-secondary">
            <span>{sessionManager.sessions.length} sessions</span>
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
                  stats={sessionStats.get(session.id)}
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
                  } catch {
                    // Best-effort delete all
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
  const [session, setSession] = React.useState<any>(null);
  const [loading, setLoading] = React.useState(true);

  useEffect(() => {
    const loadSession = async () => {
      try {
        const loadedSession = await getSession(sessionId);
        setSession(loadedSession);
      } catch {
        // Failed to load session for share dialog; loading state handles UI
      } finally {
        setLoading(false);
      }
    };
    loadSession();
  }, [sessionId]);

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

function formatTokenCount(tokens: number): string {
  if (tokens < 1000) {
    return tokens.toString();
  }
  if (tokens < 10000) {
    return `${(tokens / 1000).toFixed(1)}k`;
  }
  if (tokens < 1000000) {
    const rounded = Math.round(tokens / 1000);
    // Rounding can push values like 999,600 up to "1000k" — promote those to the M tier.
    return rounded >= 1000 ? `${(tokens / 1000000).toFixed(1)}M` : `${rounded}k`;
  }
  return `${(tokens / 1000000).toFixed(1)}M`;
}

interface SessionItemProps {
  session: SessionMetadata;
  isActive: boolean;
  showDeleteConfirm: boolean;
  isLoading?: boolean;
  isDeleting?: boolean;
  hasShares?: boolean;
  stats?: SessionStats;
  onLoad: () => void;
  onDelete: (e: React.MouseEvent) => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
  onShare: () => void;
  formatDate: (date: Date | string) => string;
}

function SessionItem({
  session,
  isActive,
  showDeleteConfirm,
  isLoading = false,
  isDeleting = false,
  hasShares = false,
  stats,
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
          ? 'bg-primary/10 border-l-2 border border-primary'
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
          <div className="flex items-center gap-1">
            {isActive && <Icon name="arrow-right" size="xs" className="text-primary flex-shrink-0" />}
            <h3 className={`font-medium text-xs truncate ${isActive ? 'text-primary font-semibold' : 'text-primary'}`}>{session.title}</h3>
          </div>
          <div className="flex items-center flex-wrap mt-0.5 text-xs text-secondary">
            <span>{formatDate(session.updatedAt)}</span>
            {' · '}
            <span>{session.messageCount} messages</span>
          </div>
          {stats && stats.runCount > 0 && (
            <div data-testid="session-stats" className="flex items-center flex-wrap mt-1 text-xs text-secondary">
              <span className="inline-flex items-center gap-0.5" title={`${stats.totalTokens.toLocaleString()} tokens`}>
                <Icon name="bolt" size="xs" />
                {formatTokenCount(stats.totalTokens)} tokens
              </span>
              {' · '}
              <span className="inline-flex items-center gap-0.5">
                <Icon name="repeat" size="xs" />
                {stats.runCount} {stats.runCount === 1 ? 'turn' : 'turns'}
              </span>
              {' · '}
              <span className="inline-flex items-center gap-0.5">
                <Icon name="cog" size="xs" />
                {stats.toolCallCount} tool {stats.toolCallCount === 1 ? 'call' : 'calls'}
              </span>
            </div>
          )}
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
