import React, { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import { useTheme2 } from '@grafana/ui';

import { useChat } from './hooks/useChat';
import { useGrafanaTheme } from './hooks/useGrafanaTheme';
import { useKeyboardNavigation, useAnnounce } from './hooks/useKeyboardNavigation';
import { useEmbeddingAllowed } from './hooks/useEmbeddingAllowed';
import { useChatScene } from './hooks/useChatScene';
import { useSidePanelState } from './hooks/useSidePanelState';
import { ChatInterfaceState } from './scenes/ChatInterfaceScene';
import { GrafanaPageState } from './scenes/GrafanaPageScene';
import { SessionSidebar, NewChatButton, HistoryButton } from './components';
import { ChatInputRef } from './components/ChatInput/ChatInput';
import { ChatErrorBoundary } from '../ErrorBoundary';
import { SessionMetadata, ChatSession } from '../../core';
import type { AppPluginSettings } from '../../types/plugin';

interface ChatProps {
  pluginSettings: AppPluginSettings;
  readOnly?: boolean;
  initialSession?: ChatSession;
}

function ChatComponent({ pluginSettings, readOnly = false, initialSession }: ChatProps): React.ReactElement | null {
  useGrafanaTheme();
  const theme = useTheme2();
  const allowEmbedding = useEmbeddingAllowed();
  const announce = useAnnounce();

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

  const {
    visiblePageRefs,
    showSidePanel,
    handleRemoveTab,
    handleClose: handleSidePanelClose,
  } = useSidePanelState({
    detectedPageRefs,
    currentSessionId: sessionManager.currentSessionId,
    allowEmbedding,
  });

  useEffect(() => {
    if (!readOnly) {
      sessionManager.refreshSessions().then(() => {
        sessionManager.loadCurrentSessionIfNeeded();
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
  const hasMessages = chatHistory.length > 0;

  const chatInterfaceState: ChatInterfaceState = useMemo(
    () => ({
      chatHistory,
      currentInput,
      isGenerating,
      toolsLoading,
      currentSessionTitle,
      isSummarizing: sessionManager.isSummarizing,
      hasSummary: !!sessionManager.currentSummary,
      setCurrentInput,
      sendMessage,
      handleKeyPress,
      chatContainerRef,
      chatInputRef,
      bottomSpacerRef,
      leftSlot: hasMessages ? <NewChatButton onConfirm={clearChat} disabled={isGenerating} /> : undefined,
      rightSlot: <HistoryButton onClick={openHistory} sessionCount={sessionManager.sessions.length} />,
      readOnly,
      onSuggestionClick: handleSuggestionClick,
    }),
    [
      chatHistory,
      currentInput,
      isGenerating,
      toolsLoading,
      currentSessionTitle,
      sessionManager.isSummarizing,
      sessionManager.currentSummary,
      sessionManager.sessions.length,
      setCurrentInput,
      sendMessage,
      handleKeyPress,
      chatContainerRef,
      chatInputRef,
      bottomSpacerRef,
      hasMessages,
      clearChat,
      openHistory,
      readOnly,
      handleSuggestionClick,
    ]
  );

  const grafanaPageState: GrafanaPageState = useMemo(
    () => ({
      pageRefs: visiblePageRefs,
      activeTabIndex: 0,
      kioskModeEnabled,
      onRemoveTab: handleRemoveTab,
      onClose: handleSidePanelClose,
    }),
    [visiblePageRefs, handleRemoveTab, kioskModeEnabled, handleSidePanelClose]
  );

  const chatScene = useChatScene(showSidePanel, chatInterfaceState, grafanaPageState, chatPanelPosition);

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

export function Chat(props: ChatProps): React.ReactElement {
  return (
    <ChatErrorBoundary>
      <ChatComponent {...props} />
    </ChatErrorBoundary>
  );
}
