import React from 'react';
import { SceneObjectBase, SceneObjectState, SceneComponentProps } from '@grafana/scenes';
import { useTheme2 } from '@grafana/ui';
import { ChatMessage as ChatMessageType } from '../types';
import { ChatHeader } from '../components/ChatHeader/ChatHeader';
import { ChatHistory } from '../components/ChatHistory/ChatHistory';
import { ChatInput, ChatInputRef } from '../components/ChatInput/ChatInput';
import { SummarizationIndicator } from '../components/SummarizationIndicator/SummarizationIndicator';
import { WelcomeMessage } from '../components/WelcomeMessage/WelcomeMessage';
import { QuickSuggestions } from '../components/QuickSuggestions/QuickSuggestions';

export interface ChatInterfaceState extends SceneObjectState {
  chatHistory: ChatMessageType[];
  currentInput: string;
  isGenerating: boolean;
  toolsLoading: boolean;
  currentSessionTitle?: string;
  isSummarizing: boolean;
  hasSummary: boolean;
  setCurrentInput: (value: string) => void;
  sendMessage: () => void;
  handleKeyPress: (e: React.KeyboardEvent) => void;
  chatContainerRef: React.RefObject<HTMLDivElement>;
  chatInputRef: React.RefObject<ChatInputRef>;
  bottomSpacerRef: React.RefObject<HTMLDivElement>;
  leftSlot?: React.ReactNode;
  rightSlot?: React.ReactNode;
  readOnly?: boolean;
  onSuggestionClick?: (message: string) => void;
}

export class ChatInterfaceScene extends SceneObjectBase<ChatInterfaceState> {
  public static Component = ChatInterfaceRenderer;

  constructor(state: ChatInterfaceState) {
    super(state);
  }
}

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
    onSuggestionClick,
  } = state;

  const hasMessages = chatHistory.length > 0;

  return (
    <div data-scene-container="chat" style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%', overflow: 'hidden' }}>
      {hasMessages ? (
        <>
          {/* Scrollable chat history area */}
          <div className="chat-interface-scroll-container w-full px-4 max-w-4xl mx-auto" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'auto' }}>
            {/* Header - only show when there are messages */}
            <ChatHeader isGenerating={isGenerating} currentSessionTitle={currentSessionTitle} />

            {/* Summarization indicator */}
            <SummarizationIndicator isSummarizing={isSummarizing} hasSummary={hasSummary} />

            {/* Chat messages */}
            <div
              ref={chatContainerRef}
              className="py-6 rounded-lg"
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
          </div>

          {/* Fixed chat input at bottom */}
          {!readOnly && (
            <div
              className="w-full px-4 max-w-4xl mx-auto flex-shrink-0 py-4"
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
        </>
      ) : (
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
                rightSlot={rightSlot}
              />
            </div>

            {/* Quick suggestions */}
            <div className="w-full">
              <QuickSuggestions onSuggestionClick={onSuggestionClick} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
