import React, { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import { useTheme2 } from '@grafana/ui';

import { useChat } from './hooks/useChat';
import { useGrafanaTheme } from './hooks/useGrafanaTheme';
import { useKeyboardNavigation, useAnnounce } from './hooks/useKeyboardNavigation';
import { useEmbeddingAllowed } from './hooks/useEmbeddingAllowed';
import { useChatScene } from './hooks/useChatScene';
import { ChatInterfaceState } from './scenes/ChatInterfaceScene';
import { GrafanaPageState } from './scenes/GrafanaPageScene';
import {
  ChatHeader,
  ChatHistory,
  ChatInput,
  WelcomeMessage,
  QuickSuggestions,
  SessionSidebar,
  SummarizationIndicator,
} from './components';
import { ChatInputRef } from './components/ChatInput/ChatInput';
import { ChatErrorBoundary } from '../ErrorBoundary';
import { SessionMetadata, ChatSession } from '../../core';
import type { AppPluginSettings } from '../../types/plugin';

interface ChatProps {
  pluginSettings: AppPluginSettings;
  readOnly?: boolean;
  initialSession?: ChatSession;
}

interface NewChatButtonProps {
  onConfirm: () => void;
  disabled: boolean;
  theme: any;
}

const NewChatButton: React.FC<NewChatButtonProps> = ({ onConfirm, disabled, theme }) => {
  const [isOpen, setIsOpen] = useState(false);
  const popupRef = useRef<HTMLDivElement>(null);

  // Close popup when clicking outside
  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        disabled={disabled}
        className="p-2 rounded-md hover:bg-white/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        aria-label="New chat"
        title="New chat"
        style={{ color: theme.colors.text.secondary }}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="12" y1="5" x2="12" y2="19"></line>
          <line x1="5" y1="12" x2="19" y2="12"></line>
        </svg>
      </button>

      {isOpen && (
        <div
          ref={popupRef}
          className="absolute bottom-full left-0 mb-2 w-48 p-3 rounded-lg shadow-xl border z-50 flex flex-col gap-2"
          style={{
            backgroundColor: theme.colors.background.primary,
            borderColor: theme.colors.border.weak,
          }}
        >
          <p className="text-xs font-medium mb-1" style={{ color: theme.colors.text.primary }}>
            Start a new chat?
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => {
                onConfirm();
                setIsOpen(false);
              }}
              className="flex-1 px-2 py-1 text-xs rounded font-medium transition-colors"
              style={{
                backgroundColor: theme.colors.primary.main,
                color: theme.colors.text.primary,
              }}
            >
              Yes
            </button>
            <button
              onClick={() => setIsOpen(false)}
              className="flex-1 px-2 py-1 text-xs rounded font-medium transition-colors hover:bg-white/10"
              style={{
                color: theme.colors.text.secondary,
                border: `1px solid ${theme.colors.border.weak}`,
              }}
            >
              No
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

function ChatComponent({ pluginSettings, readOnly = false, initialSession }: ChatProps) {
  // Sync Grafana theme to CSS custom properties
  useGrafanaTheme();
  const theme = useTheme2();
  const allowEmbedding = useEmbeddingAllowed();

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

  // Refresh sessions and load current session when component mounts (e.g., on page refresh)
  useEffect(() => {
    if (!readOnly) {
      // Refresh sessions list first
      sessionManager.refreshSessions().then(() => {
        // Then load current session if chatHistory is empty (e.g., on page refresh)
        // This ensures we have the latest sessions list before checking for current session
        sessionManager.loadCurrentSessionIfNeeded();
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run on mount

  const visiblePageRefs = detectedPageRefs.filter((ref) => !removedTabUrls.has(ref.url));

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
    // Get the message index that the current page refs come from
    const currentSourceIndex = detectedPageRefs.length > 0 ? detectedPageRefs[0].messageIndex : null;
    const prevSourceIndex = prevSourceMessageIndexRef.current;
    const currentSessionId = sessionManager.currentSessionId;
    const prevSessionId = prevSessionIdRef.current;

    // Reset state when session changes OR when page refs come from a different message
    const sessionChanged = currentSessionId !== prevSessionId;
    const messageIndexChanged = currentSourceIndex !== null && currentSourceIndex !== prevSourceIndex;

    if (sessionChanged) {
      // Always reset removed tabs when switching sessions to prevent cross-session state bleed
      setRemovedTabUrls(new Set());
      if (currentSourceIndex !== null) {
        setIsSidePanelOpen(true);
      }
    } else if (messageIndexChanged) {
      // New page refs from a different message in the same session
      setIsSidePanelOpen(true);
      setRemovedTabUrls(new Set());
    }

    prevSourceMessageIndexRef.current = currentSourceIndex;
    prevSessionIdRef.current = currentSessionId;
  }, [detectedPageRefs, sessionManager.currentSessionId]);

  // Keyboard navigation callbacks
  const focusChatInput = useCallback(() => {
    chatInputRef.current?.focus();
    announce('Chat input focused');
  }, [announce]);

  const openHistory = useCallback(() => {
    setIsHistoryOpen(true);
    announce('Chat history opened');
  }, [announce]);

  // Set up keyboard shortcuts
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

  const handleSuggestionClick = (message: string) => {
    setCurrentInput(message);
    // Focus the input after setting the message
    setTimeout(() => {
      chatInputRef.current?.focus();
    }, 100);
    announce(`Suggestion selected: ${message.substring(0, 50)}...`);
  };

  // Get current session title
  const currentSession = sessionManager.sessions.find((s: SessionMetadata) => s.id === sessionManager.currentSessionId);
  const currentSessionTitle = currentSession?.title;

  const hasMessages = chatHistory.length > 0;
  const showSidePanel = isSidePanelOpen && visiblePageRefs.length > 0 && allowEmbedding === true;

  // Prepare state for chat scene
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
      leftSlot: <NewChatButton onConfirm={clearChat} disabled={isGenerating} theme={theme} />,
      rightSlot: (
        <button
          onClick={openHistory}
          className="flex items-center gap-2 px-2 py-1 text-xs font-medium rounded-md hover:bg-white/10 transition-colors"
          aria-label="Chat history"
          title="View chat history"
          style={{ color: theme.colors.text.secondary }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
          <span>View chat history ({sessionManager.sessions.length})</span>
        </button>
      ),
      readOnly,
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
      clearChat,
      theme,
      openHistory,
      readOnly,
    ]
  );

  // Prepare state for Grafana page scene
  const grafanaPageState: GrafanaPageState = useMemo(
    () => ({
      pageRefs: visiblePageRefs,
      activeTabIndex: 0,
      onRemoveTab: handleRemoveTab,
      onClose: () => setIsSidePanelOpen(false),
    }),
    [visiblePageRefs, handleRemoveTab]
  );

  // Create scene when side panel should be shown
  const chatScene = useChatScene(showSidePanel, chatInterfaceState, grafanaPageState);

  if (toolsError) {
    return <div>Error: {toolsError.message}</div>;
  }

  return (
    <div
      className="w-full min-h-full flex"
      role="main"
      aria-label="Chat interface"
      style={{
        backgroundColor: theme.isDark ? '#111217' : theme.colors.background.canvas,
      }}
    >
      {chatScene ? (
        // Scene-based layout with SplitLayout (when side panel is shown)
        <div className="flex-1">
          <chatScene.Component model={chatScene} />
        </div>
      ) : (
        // Regular React layout (when no side panel)
        <>
          {/* Main chat area */}
          <div className="flex-1 flex flex-col min-h-0 min-w-0">
        {hasMessages ? (
          <div
            className={`flex-1 flex flex-col min-h-0 w-full px-4 ${showSidePanel ? 'max-w-none' : 'max-w-4xl mx-auto'}`}
          >
            {/* Header - only show when there are messages */}
            <ChatHeader isGenerating={isGenerating} currentSessionTitle={currentSessionTitle} />

            {/* Summarization indicator */}
            <SummarizationIndicator
              isSummarizing={sessionManager.isSummarizing}
              hasSummary={!!sessionManager.currentSummary}
            />

            {/* Chat messages */}
            <div
              ref={chatContainerRef}
              className="flex-1 py-6 rounded-lg"
              role="log"
              aria-label="Chat messages"
              aria-live="polite"
              aria-relevant="additions"
              tabIndex={0}
              style={{
                backgroundColor: theme.isDark ? '#1a1b1f' : theme.colors.background.primary,
              }}
            >
              <div className="px-4">
                <ChatHistory chatHistory={chatHistory} isGenerating={isGenerating} />
                <div ref={bottomSpacerRef} className="h-16" style={{ scrollMarginBottom: '100px' }} />
              </div>
            </div>

            {/* Chat input at bottom */}
            {!readOnly && (
              <div
                className="flex-shrink-0 py-4 sticky bottom-0 z-10"
                role="region"
                aria-label="Message input"
                style={{
                  backgroundColor: theme.isDark ? '#111217' : theme.colors.background.canvas,
                }}
              >
                <ChatInput
                  ref={chatInputRef}
                  currentInput={currentInput}
                  isGenerating={isGenerating}
                  toolsLoading={toolsLoading}
                  setCurrentInput={setCurrentInput}
                  sendMessage={sendMessage}
                  handleKeyPress={handleKeyPress}
                  leftSlot={<NewChatButton onConfirm={clearChat} disabled={isGenerating} theme={theme} />}
                  rightSlot={
                    <button
                      onClick={openHistory}
                      className="flex items-center gap-2 px-2 py-1 text-xs font-medium rounded-md hover:bg-white/10 transition-colors"
                      aria-label="Chat history"
                      title="View chat history"
                      style={{ color: theme.colors.text.secondary }}
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <circle cx="12" cy="12" r="10" />
                        <polyline points="12 6 12 12 16 14" />
                      </svg>
                      <span>View chat history ({sessionManager.sessions.length})</span>
                    </button>
                  }
                />
              </div>
            )}
          </div>
        ) : (
          /* Welcome state - centered layout, full width background */
          /* Welcome state - centered layout with sticky input */
          <div className="flex-1 flex flex-col min-h-0 w-full max-w-3xl mx-auto px-4">
            <div className="flex-1 flex flex-col items-center justify-center py-8">
              {/* Welcome header */}
              <WelcomeMessage />

              {/* Chat Input */}
              <div className="w-full mt-10 mb-4" role="region" aria-label="Message input">
                <ChatInput
                  ref={chatInputRef}
                  currentInput={currentInput}
                  isGenerating={isGenerating}
                  toolsLoading={toolsLoading}
                  setCurrentInput={setCurrentInput}
                  sendMessage={sendMessage}
                  handleKeyPress={handleKeyPress}
                  leftSlot={undefined}
                  rightSlot={
                    <button
                      onClick={openHistory}
                      className="flex items-center gap-2 px-2 py-1 text-xs font-medium rounded-md hover:bg-white/10 transition-colors"
                      aria-label="Chat history"
                      title="View chat history"
                      style={{ color: theme.colors.text.secondary }}
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <circle cx="12" cy="12" r="10" />
                        <polyline points="12 6 12 12 16 14" />
                      </svg>
                      <span>View chat history ({sessionManager.sessions.length})</span>
                    </button>
                  }
                />
              </div>

              {/* Quick suggestions */}
              <div className="w-full">
                <QuickSuggestions onSuggestionClick={handleSuggestionClick} />
              </div>
            </div>
          </div>
        )}
          </div>
        </>
      )}

      {/* Session sidebar - outside scene */}
      <SessionSidebar
        sessionManager={sessionManager}
        currentSessionId={sessionManager.currentSessionId}
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
      />
    </div>
  );
}

// Export the Chat component wrapped with error boundary
export function Chat(props: ChatProps) {
  return (
    <ChatErrorBoundary>
      <ChatComponent {...props} />
    </ChatErrorBoundary>
  );
}
