import React from 'react';
import { SceneObjectBase, SceneObjectState, SceneComponentProps } from '@grafana/scenes';
import { useTheme2 } from '@grafana/ui';
import { ChatMessage as ChatMessageType } from '../types';
import { ChatHeader } from '../components/ChatHeader/ChatHeader';
import { ChatHistory } from '../components/ChatHistory/ChatHistory';
import { ChatInput, ChatInputRef } from '../components/ChatInput/ChatInput';
import { SummarizationIndicator } from '../components/SummarizationIndicator/SummarizationIndicator';

/**
 * State interface for ChatInterfaceScene
 * Contains all props needed to render the chat interface
 */
export interface ChatInterfaceState extends SceneObjectState {
  // Chat history and state
  chatHistory: ChatMessageType[];
  currentInput: string;
  isGenerating: boolean;
  toolsLoading: boolean;

  // Session info
  currentSessionTitle?: string;
  isSummarizing: boolean;
  hasSummary: boolean;

  // Callbacks
  setCurrentInput: (value: string) => void;
  sendMessage: () => void;
  handleKeyPress: (e: React.KeyboardEvent) => void;

  // Refs
  chatContainerRef: React.RefObject<HTMLDivElement>;
  chatInputRef: React.RefObject<ChatInputRef>;
  bottomSpacerRef: React.RefObject<HTMLDivElement>;

  // Slots for custom buttons
  leftSlot?: React.ReactNode;
  rightSlot?: React.ReactNode;

  // Read-only mode flag
  readOnly?: boolean;
}

/**
 * Custom scene object for the chat interface
 * Wraps ChatHeader, ChatHistory, and ChatInput in a scene-compatible component
 */
export class ChatInterfaceScene extends SceneObjectBase<ChatInterfaceState> {
  public static Component = ChatInterfaceRenderer;

  constructor(state: ChatInterfaceState) {
    super(state);
  }
}

/**
 * React renderer for ChatInterfaceScene
 * Renders the chat interface using Grafana theme
 */
function ChatInterfaceRenderer({ model }: SceneComponentProps<ChatInterfaceScene>) {
  const state = model.useState();
  const theme = useTheme2();

  const {
    chatHistory,
    currentInput,
    isGenerating,
    toolsLoading,
    currentSessionTitle,
    isSummarizing,
    hasSummary,
    setCurrentInput,
    sendMessage,
    handleKeyPress,
    chatContainerRef,
    chatInputRef,
    bottomSpacerRef,
    leftSlot,
    rightSlot,
    readOnly,
  } = state;

  const hasMessages = chatHistory.length > 0;

  return (
    <div className="flex-1 flex flex-col min-h-0 w-full px-4 max-w-4xl mx-auto">
      {/* Header - only show when there are messages */}
      {hasMessages && <ChatHeader isGenerating={isGenerating} currentSessionTitle={currentSessionTitle} />}

      {/* Summarization indicator */}
      {hasMessages && <SummarizationIndicator isSummarizing={isSummarizing} hasSummary={hasSummary} />}

      {/* Chat messages */}
      {hasMessages && (
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
      )}

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
            leftSlot={leftSlot}
            rightSlot={rightSlot}
          />
        </div>
      )}
    </div>
  );
}
