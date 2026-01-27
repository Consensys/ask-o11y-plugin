import React, { useMemo } from 'react';
import { useTheme2 } from '@grafana/ui';
import { ChatInterfaceProps } from '../scenes/ChatInterfaceScene';
import { ChatMessage } from '../types';
import { ChatInputRef } from '../components/ChatInput/ChatInput';
import { NewChatButton } from '../components/NewChatButton';
import type { useSessionManager } from './useSessionManager';

export interface UseChatInterfaceParams {
  // From useChat
  chatHistory: ChatMessage[];
  currentInput: string;
  isGenerating: boolean;
  toolsLoading: boolean;
  setCurrentInput: (value: string) => void;
  sendMessage: () => void;
  handleKeyPress: (e: React.KeyboardEvent) => void;
  chatContainerRef: React.RefObject<HTMLDivElement>;
  bottomSpacerRef: React.RefObject<HTMLDivElement>;
  sessionManager: ReturnType<typeof useSessionManager>;

  // Local refs
  chatInputRef: React.RefObject<ChatInputRef>;

  // Derived state
  currentSessionTitle?: string;

  // Local callbacks
  clearChat: () => void;
  openHistory: () => void;
  handleSuggestionClick: (message: string) => void;

  // Props
  readOnly?: boolean;
}

/**
 * Custom hook that builds ChatInterfaceProps for the ChatInterfaceScene.
 * Encapsulates the logic for constructing chat interface configuration,
 * including the left and right slots with interactive buttons.
 */
export function useChatInterface(params: UseChatInterfaceParams): ChatInterfaceProps {
  const theme = useTheme2();
  const hasMessages = params.chatHistory.length > 0;

  return useMemo(
    () => ({
      chatHistory: params.chatHistory,
      currentInput: params.currentInput,
      isGenerating: params.isGenerating,
      toolsLoading: params.toolsLoading,
      currentSessionTitle: params.currentSessionTitle,
      isSummarizing: params.sessionManager.isSummarizing,
      hasSummary: !!params.sessionManager.currentSummary,
      setCurrentInput: params.setCurrentInput,
      sendMessage: params.sendMessage,
      handleKeyPress: params.handleKeyPress,
      chatContainerRef: params.chatContainerRef,
      chatInputRef: params.chatInputRef,
      bottomSpacerRef: params.bottomSpacerRef,
      leftSlot: hasMessages
        ? React.createElement(NewChatButton, {
            onConfirm: params.clearChat,
            disabled: params.isGenerating,
            theme,
          })
        : undefined,
      rightSlot: React.createElement(
        'button',
        {
          onClick: params.openHistory,
          className: 'flex items-center gap-2 px-2 py-1 text-xs font-medium rounded-md hover:bg-white/10 transition-colors',
          'aria-label': 'Chat history',
          title: 'View chat history',
          style: { color: theme.colors.text.secondary },
        },
        React.createElement(
          'svg',
          {
            width: 14,
            height: 14,
            viewBox: '0 0 24 24',
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 2,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
          },
          React.createElement('circle', { cx: 12, cy: 12, r: 10 }),
          React.createElement('polyline', { points: '12 6 12 12 16 14' })
        ),
        React.createElement('span', null, `View chat history (${params.sessionManager.sessions.length})`)
      ),
      readOnly: params.readOnly,
      onSuggestionClick: params.handleSuggestionClick,
    }),
    [
      params.chatHistory,
      params.currentInput,
      params.isGenerating,
      params.toolsLoading,
      params.currentSessionTitle,
      params.sessionManager.isSummarizing,
      params.sessionManager.currentSummary,
      params.sessionManager.sessions.length,
      params.setCurrentInput,
      params.sendMessage,
      params.handleKeyPress,
      params.chatContainerRef,
      params.chatInputRef,
      params.bottomSpacerRef,
      hasMessages,
      params.clearChat,
      theme,
      params.openHistory,
      params.readOnly,
      params.handleSuggestionClick,
    ]
  );
}
