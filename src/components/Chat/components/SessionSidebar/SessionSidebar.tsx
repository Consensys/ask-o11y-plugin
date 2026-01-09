import React, { useState } from 'react';
import { UseSessionManagerReturn } from '../../hooks/useSessionManager';
import { SessionMetadata } from '../../../../core';
import { LoadingOverlay, LoadingButton, InlineLoading } from '../../../LoadingOverlay';

interface SessionSidebarProps {
  sessionManager: UseSessionManagerReturn;
  currentSessionId: string | null;
  isOpen: boolean;
  onClose: () => void;
}

export function SessionSidebar({ sessionManager, currentSessionId, isOpen, onClose }: SessionSidebarProps) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [importLoading, setImportLoading] = useState(false);
  const [creatingSession, setCreatingSession] = useState(false);

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
      sessionManager.loadSession(sessionId);
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
      sessionManager.deleteSession(sessionId);
      setShowDeleteConfirm(null);
    } finally {
      setLoadingAction(null);
    }
  };

  const handleExport = async (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setLoadingAction(`exporting-${sessionId}`);
    try {
      await new Promise((resolve) => setTimeout(resolve, 300)); // Small delay for UX
      sessionManager.exportSession(sessionId);
    } finally {
      setLoadingAction(null);
    }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setImportLoading(true);
      const reader = new FileReader();
      reader.onload = async (event) => {
        const jsonData = event.target?.result as string;
        await new Promise((resolve) => setTimeout(resolve, 500)); // Simulate processing
        const success = sessionManager.importSession(jsonData);
        if (success) {
          setShowImport(false);
        } else {
          alert('Failed to import session. Please check the file format.');
        }
        setImportLoading(false);
      };
      reader.onerror = () => {
        setImportLoading(false);
        alert('Failed to read file');
      };
      reader.readAsText(file);
    }
  };

  const storagePercent = Math.round((sessionManager.storageStats.used / sessionManager.storageStats.total) * 100);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Sidebar */}
      <div className="relative w-80 bg-white dark:bg-gray-900 shadow-xl flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-lg font-semibold">Chat History</h2>
            <button onClick={onClose} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded" title="Close">
              ✕
            </button>
          </div>

          {/* Actions */}
          <div className="flex gap-2 mt-3">
            <LoadingButton
              onClick={async () => {
                setCreatingSession(true);
                try {
                  await sessionManager.createNewSession();
                  onClose();
                } finally {
                  setCreatingSession(false);
                }
              }}
              isLoading={creatingSession}
              loadingText="Creating..."
              variant="primary"
              size="sm"
              className="flex-1"
            >
              + New Chat
            </LoadingButton>
            <button
              onClick={() => setShowImport(true)}
              className="px-3 py-1.5 text-sm bg-gray-200 dark:bg-gray-700 rounded hover:bg-gray-300 dark:hover:bg-gray-600"
              title="Import session"
              disabled={importLoading}
            >
              Import
            </button>
          </div>

          {/* Storage indicator */}
          <div className="mt-3 text-xs text-gray-600 dark:text-gray-400">
            <div className="flex justify-between mb-1">
              <span>{sessionManager.sessions.length} sessions</span>
              <span>{storagePercent}% storage used</span>
            </div>
            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5">
              <div
                className={`h-1.5 rounded-full ${storagePercent > 80 ? 'bg-red-500' : 'bg-blue-500'}`}
                style={{ width: `${storagePercent}%` }}
              />
            </div>
          </div>
        </div>

        {/* Session list */}
        <div className="flex-1 overflow-y-auto p-2">
          {sessionManager.sessions.length === 0 ? (
            <div className="text-center text-gray-500 dark:text-gray-400 mt-8">
              <p>No saved conversations yet</p>
              <p className="text-sm mt-2">Start a new chat to begin</p>
            </div>
          ) : (
            <div className="space-y-1">
              {sessionManager.sessions.map((session: SessionMetadata) => (
                <SessionItem
                  key={session.id}
                  session={session}
                  isActive={session.id === currentSessionId}
                  showDeleteConfirm={showDeleteConfirm === session.id}
                  isLoading={loadingAction === `loading-${session.id}`}
                  isDeleting={loadingAction === `deleting-${session.id}`}
                  isExporting={loadingAction === `exporting-${session.id}`}
                  onLoad={() => handleLoadSession(session.id)}
                  onDelete={(e) => handleDeleteClick(session.id, e)}
                  onConfirmDelete={() => confirmDelete(session.id)}
                  onCancelDelete={() => setShowDeleteConfirm(null)}
                  onExport={(e) => handleExport(session.id, e)}
                  formatDate={formatDate}
                />
              ))}
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="p-3 border-t border-gray-200 dark:border-gray-700">
          {sessionManager.sessions.length > 0 && (
            <button
              onClick={() => {
                if (confirm('Are you sure you want to delete all conversations? This cannot be undone.')) {
                  sessionManager.deleteAllSessions();
                }
              }}
              className="w-full px-3 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
            >
              Clear All History
            </button>
          )}
        </div>

        {/* Import modal */}
        {showImport && (
          <div className="absolute inset-0 bg-white/95 dark:bg-gray-900/95 flex items-center justify-center p-4">
            <LoadingOverlay isLoading={importLoading} message="Importing session...">
              <div className="w-full max-w-sm">
                <h3 className="text-lg font-semibold mb-4">Import Session</h3>
                <input
                  type="file"
                  accept=".json"
                  onChange={handleImport}
                  disabled={importLoading}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded disabled:opacity-50"
                />
                <button
                  onClick={() => setShowImport(false)}
                  disabled={importLoading}
                  className="mt-3 w-full px-3 py-2 text-sm bg-gray-200 dark:bg-gray-700 rounded hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </LoadingOverlay>
          </div>
        )}
      </div>
    </div>
  );
}

interface SessionItemProps {
  session: SessionMetadata;
  isActive: boolean;
  showDeleteConfirm: boolean;
  isLoading?: boolean;
  isDeleting?: boolean;
  isExporting?: boolean;
  onLoad: () => void;
  onDelete: (e: React.MouseEvent) => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
  onExport: (e: React.MouseEvent) => void;
  formatDate: (date: Date) => string;
}

function SessionItem({
  session,
  isActive,
  showDeleteConfirm,
  isLoading = false,
  isDeleting = false,
  isExporting = false,
  onLoad,
  onDelete,
  onConfirmDelete,
  onCancelDelete,
  onExport,
  formatDate,
}: SessionItemProps) {
  if (showDeleteConfirm) {
    return (
      <div className="p-3 bg-red-50 dark:bg-red-900/20 rounded border border-red-200 dark:border-red-800">
        <p className="text-sm text-red-900 dark:text-red-200 mb-2">Delete this conversation?</p>
        <div className="flex gap-2">
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
            className="flex-1 px-2 py-1 text-sm bg-gray-200 dark:bg-gray-700 rounded hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      onClick={isLoading ? undefined : onLoad}
      className={`p-3 rounded group transition-colors relative ${
        isActive
          ? 'bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800'
          : 'hover:bg-gray-100 dark:hover:bg-gray-800'
      } ${isLoading ? 'cursor-wait opacity-75' : 'cursor-pointer'}`}
    >
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/50 dark:bg-gray-900/50 rounded">
          <InlineLoading message="Loading..." size="sm" />
        </div>
      )}

      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <h3 className="font-medium text-sm truncate">{session.title}</h3>
          <div className="flex items-center gap-2 mt-1 text-xs text-gray-600 dark:text-gray-400">
            <span>{formatDate(session.updatedAt)}</span>
            <span>•</span>
            <span>{session.messageCount} messages</span>
          </div>
        </div>

        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={onExport}
            disabled={isExporting}
            className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded disabled:opacity-50"
            title="Export"
          >
            {isExporting ? <InlineLoading size="sm" /> : '↓'}
          </button>
          <button
            onClick={onDelete}
            disabled={isLoading || isExporting}
            className="p-1 hover:bg-red-100 dark:hover:bg-red-900/20 text-red-600 dark:text-red-400 rounded disabled:opacity-50"
            title="Delete"
          >
            🗑
          </button>
        </div>
      </div>
    </div>
  );
}
