import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useTheme2 } from '@grafana/ui';

import { useChat } from './hooks/useChat';
import { useKeyboardNavigation } from './hooks/useKeyboardNavigation';
import { useEmbeddingAllowed } from './hooks/useEmbeddingAllowed';
import { useChatScene } from './hooks/useChatScene';
import { useSidePanelState } from './hooks/useSidePanelState';
import { ChatInterfaceState } from './scenes/ChatInterfaceScene';
import { GrafanaPageState } from './scenes/GrafanaPageScene';
import { SessionSidebar, NewChatButton, HistoryButton, SaveToMemoryButton, ModelSelector } from './components';
import { ChatInputRef } from './components/ChatInput/ChatInput';
import { ChatErrorBoundary } from '../ErrorBoundary';
import type { SessionMetadata } from './hooks/useSessionManager';
import type { ChatMessage } from './types';
import type { AppPluginSettings } from '../../types/plugin';
import {
  formatModelLabel,
  formatModelSelectionLabel,
  listLLMModelOptions,
  type LLMModelOption,
  type LLMModelSelection,
} from '../../services/llmModels';

interface ChatProps {
  pluginSettings: AppPluginSettings;
  readOnly?: boolean;
  initialSession?: { id?: string; messages?: ChatMessage[] };
  initialMessage?: string;
  initialMessageType?: 'chat' | 'investigation' | 'performance';
  sessionIdFromUrl: string | null;
  onSessionIdChange: (sessionId: string | null) => void;
}

function ChatComponent({
  pluginSettings,
  readOnly = false,
  initialSession,
  initialMessage,
  initialMessageType,
  sessionIdFromUrl,
  onSessionIdChange,
}: ChatProps): React.ReactElement | null {
  const theme = useTheme2();
  const allowEmbedding = useEmbeddingAllowed();
  const [modelOptions, setModelOptions] = useState<LLMModelOption[]>([]);
  const [selectedModel, setSelectedModel] = useState<LLMModelSelection>('auto');

  const kioskModeEnabled = pluginSettings?.kioskModeEnabled ?? true;
  const chatPanelPosition = pluginSettings?.chatPanelPosition || 'right';

  useEffect(() => {
    let cancelled = false;
    listLLMModelOptions()
      .then((options) => {
        if (cancelled) {
          return;
        }
        setModelOptions(options);
        setSelectedModel((prev) => (options.some((option) => option.value === prev) ? prev : 'auto'));
      })
      .catch(() => {
        if (!cancelled) {
          setModelOptions([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const {
    chatHistory,
    currentInput,
    isGenerating,
    chatContainerRef,
    setCurrentInput,
    sendMessage,
    handleKeyPress,
    clearChat,
    sessionManager,
    bottomSpacerRef,
    detectedPageRefs,
    messageQueue,
    stopGeneration,
    resolveApproval,
  } = useChat(
    pluginSettings,
    sessionIdFromUrl,
    onSessionIdChange,
    readOnly ? initialSession : undefined,
    readOnly,
    initialMessage,
    initialMessageType,
    selectedModel
  );

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

  const containerRef = useRef<HTMLDivElement>(null);

  const openHistory = useCallback(() => {
    setIsHistoryOpen(true);
  }, []);

  useKeyboardNavigation(containerRef);

  const handleSuggestionClick = useCallback((message: string) => {
    setCurrentInput(message);
    setTimeout(() => {
      chatInputRef.current?.focus();
    }, 100);
  }, [setCurrentInput]);

  const currentSession = sessionManager.sessions.find((s: SessionMetadata) => s.id === sessionManager.currentSessionId);
  const currentSessionTitle = currentSession?.title;
  const sessionModel = currentSession?.model;
  const selectedModelOption = modelOptions.find((option) => option.value === selectedModel);
  const sessionModelOption = modelOptions.find((option) => option.value === sessionModel);
  const currentModelLabel = sessionModel
    ? sessionModelOption?.label || formatModelLabel(sessionModel)
    : chatHistory.length > 0
      ? selectedModelOption?.label || formatModelSelectionLabel(selectedModel)
      : undefined;
  const hasMessages = chatHistory.length > 0;
  const graphitiEnabled = pluginSettings.mcpServers?.some((s) => s.id === 'graphiti' && s.enabled) ?? false;
  const showModelSelector = !readOnly && modelOptions.length > 0 && !sessionModel;
  const modelSelector = useMemo(
    () =>
      showModelSelector ? (
        <ModelSelector
          options={modelOptions}
          value={selectedModel}
          disabled={isGenerating}
          onChange={setSelectedModel}
        />
      ) : undefined,
    [showModelSelector, modelOptions, selectedModel, isGenerating]
  );

  const chatInterfaceState: ChatInterfaceState = useMemo(
    () => ({
      chatHistory,
      currentInput,
      isGenerating,
      currentSessionTitle,
      currentModelLabel,
      setCurrentInput,
      sendMessage,
      handleKeyPress,
      chatContainerRef,
      chatInputRef,
      bottomSpacerRef,
      leftSlot: hasMessages ? (
        <div className="flex items-center gap-2">
          <NewChatButton onConfirm={clearChat} isGenerating={isGenerating} />
          {modelSelector}
        </div>
      ) : modelSelector,
      rightSlot: (
        <div className="flex items-center gap-1">
          {graphitiEnabled && hasMessages && <SaveToMemoryButton messages={chatHistory} />}
          <HistoryButton onClick={openHistory} sessionCount={sessionManager.sessions.length} />
        </div>
      ),
      readOnly,
      onSuggestionClick: handleSuggestionClick,
      queuedMessageCount: messageQueue.length,
      onStopGeneration: stopGeneration,
      onResolveApproval: resolveApproval,
    }),
    [
      chatHistory,
      currentInput,
      isGenerating,
      currentSessionTitle,
      currentModelLabel,
      sessionManager.sessions.length,
      setCurrentInput,
      sendMessage,
      handleKeyPress,
      chatContainerRef,
      chatInputRef,
      bottomSpacerRef,
      hasMessages,
      modelSelector,
      graphitiEnabled,
      clearChat,
      openHistory,
      readOnly,
      handleSuggestionClick,
      messageQueue.length,
      stopGeneration,
      resolveApproval,
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

  return (
    <div
      ref={containerRef}
      className="w-full h-full flex"
      role="main"
      aria-label="Chat interface"
      style={{
        backgroundColor: theme.colors.background.canvas,
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
