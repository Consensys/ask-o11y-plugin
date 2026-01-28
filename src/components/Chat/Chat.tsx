import React, { useRef, useState, useCallback, useEffect } from 'react';
import { useTheme2 } from '@grafana/ui';

import { useChat } from './hooks/useChat';
import { useGrafanaTheme } from './hooks/useGrafanaTheme';
import { useKeyboardNavigation, useAnnounce } from './hooks/useKeyboardNavigation';
import { useEmbeddingAllowed } from './hooks/useEmbeddingAllowed';
import { useChatScene } from './hooks/useChatScene';
import { useChatInterface } from './hooks/useChatInterface';
import { useGrafanaPage } from './hooks/useGrafanaPage';
import { SessionSidebar } from './components';
import { ChatInputRef } from './components/ChatInput/ChatInput';
import { ChatErrorBoundary } from '../ErrorBoundary';
import { SessionMetadata, ChatSession } from '../../core';
import type { AppPluginSettings } from '../../types/plugin';

interface ChatProps {
  pluginSettings: AppPluginSettings;
  readOnly?: boolean;
  initialSession?: ChatSession;
}

function ChatComponent({ pluginSettings, readOnly = false, initialSession }: ChatProps) {
  useGrafanaTheme();
  const theme = useTheme2();
  const allowEmbedding = useEmbeddingAllowed();

  const kioskModeEnabled = pluginSettings?.kioskModeEnabled ?? true;
  const chatPanelPosition = pluginSettings?.chatPanelPosition || 'right';

  const {
    chatHistory,
    currentInput,
    isGenerating,
    chatContainerRef,
    toolsLoading,
    toolsError,
    setCurrentInput,
    sendMessage,
    handleKeyPress,
    clearChat,

    sessionManager,
    bottomSpacerRef,
    detectedPageRefs,
  } = useChat(pluginSettings, readOnly ? initialSession : undefined, readOnly);

  const chatInputRef = useRef<ChatInputRef>(null);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isSidePanelOpen, setIsSidePanelOpen] = useState(false);
  const [removedTabUrls, setRemovedTabUrls] = useState<Set<string>>(new Set());
  const prevSourceMessageIndexRef = useRef<number | null>(null);
  const prevSessionIdRef = useRef<string | null>(null);
  const announce = useAnnounce();

  useEffect(() => {
    if (!readOnly) {
      sessionManager.refreshSessions().then(() => {
        sessionManager.loadCurrentSessionIfNeeded();
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visiblePageRefs = detectedPageRefs
    .filter((ref) => !removedTabUrls.has(ref.url))
    .slice(-4);

  const handleRemoveTab = useCallback(
    (index: number) => {
      const tabToRemove = visiblePageRefs[index];
      if (tabToRemove) {
        setRemovedTabUrls((prev) => new Set(prev).add(tabToRemove.url));
      }
    },
    [visiblePageRefs]
  );

  useEffect(() => {
    const currentSourceIndex = detectedPageRefs.length > 0 ? detectedPageRefs[0].messageIndex : null;
    const currentSessionId = sessionManager.currentSessionId;

    const sessionChanged = currentSessionId !== prevSessionIdRef.current;
    const messageIndexChanged = currentSourceIndex !== null && currentSourceIndex !== prevSourceMessageIndexRef.current;

    if (sessionChanged || messageIndexChanged) {
      setRemovedTabUrls(new Set());
      if (currentSourceIndex !== null) {
        setIsSidePanelOpen(true);
      }
    }

    prevSourceMessageIndexRef.current = currentSourceIndex;
    prevSessionIdRef.current = currentSessionId;
  }, [detectedPageRefs, sessionManager.currentSessionId]);

  const focusChatInput = useCallback(() => {
    chatInputRef.current?.focus();
    announce('Chat input focused');
  }, [announce]);

  const openHistory = useCallback(() => {
    setIsHistoryOpen(true);
    announce('Chat history opened');
  }, [announce]);

  useKeyboardNavigation({
    onNewChat: () => {
      sessionManager.createNewSession();
      announce('New chat created');
    },
    onClearChat: () => {
      if (window.confirm('Are you sure you want to clear the current chat?')) {
        clearChat();
        announce('Chat cleared');
      }
    },
    onOpenHistory: openHistory,
    onFocusInput: focusChatInput,
  });

  const handleSuggestionClick = useCallback((message: string) => {
    setCurrentInput(message);
    setTimeout(() => {
      chatInputRef.current?.focus();
    }, 100);
    announce(`Suggestion selected: ${message.substring(0, 50)}...`);
  }, [setCurrentInput, announce]);

  const currentSession = sessionManager.sessions.find((s: SessionMetadata) => s.id === sessionManager.currentSessionId);
  const currentSessionTitle = currentSession?.title;

  const showSidePanel = isSidePanelOpen && visiblePageRefs.length > 0 && allowEmbedding === true;

  const chatInterfaceProps = useChatInterface({
    chatHistory,
    currentInput,
    isGenerating,
    toolsLoading,
    setCurrentInput,
    sendMessage,
    handleKeyPress,
    chatContainerRef,
    chatInputRef,
    bottomSpacerRef,
    sessionManager,
    currentSessionTitle,
    clearChat,
    openHistory,
    handleSuggestionClick,
    readOnly,
  });

  const grafanaPageProps = useGrafanaPage({
    visiblePageRefs,
    kioskModeEnabled,
    handleRemoveTab,
    onClose: () => setIsSidePanelOpen(false),
  });

  const chatScene = useChatScene(showSidePanel, chatInterfaceProps, grafanaPageProps, chatPanelPosition);

  if (toolsError) {
    return <div>Error: {toolsError.message}</div>;
  }

  return (
    <div
      className="w-full h-full flex"
      role="main"
      aria-label="Chat interface"
      style={{
        backgroundColor: theme.isDark ? '#111217' : theme.colors.background.canvas,
      }}
    >
      {chatScene && (
        <div data-plugin-split-layout style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <chatScene.Component model={chatScene} />
        </div>
      )}

      <SessionSidebar
        sessionManager={sessionManager}
        currentSessionId={sessionManager.currentSessionId}
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
      />
    </div>
  );
}

export function Chat(props: ChatProps) {
  return (
    <ChatErrorBoundary>
      <ChatComponent {...props} />
    </ChatErrorBoundary>
  );
}
