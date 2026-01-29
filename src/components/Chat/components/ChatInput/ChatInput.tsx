import React, { forwardRef, useImperativeHandle, useRef, useEffect, useState } from 'react';
import { Icon, Alert, useTheme2 } from '@grafana/ui';
import { ValidationService } from '../../../../services/validation';

interface ChatInputProps {
  currentInput: string;
  isGenerating: boolean;
  toolsLoading: boolean;
  setCurrentInput: (value: string) => void;
  sendMessage: () => void;
  handleKeyPress: (e: React.KeyboardEvent) => void;
  rightSlot?: React.ReactNode;
  leftSlot?: React.ReactNode;
}

export interface ChatInputRef {
  focus: (moveCursorToEnd?: boolean) => void;
}

export const ChatInput = forwardRef<ChatInputRef, ChatInputProps>(
  (
    { currentInput, isGenerating, toolsLoading, setCurrentInput, sendMessage, handleKeyPress, rightSlot, leftSlot },
    ref
  ) => {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const [validationError, setValidationError] = useState<string | null>(null);
    const theme = useTheme2();

    useImperativeHandle(ref, () => ({
      focus: (moveCursorToEnd = false) => {
        if (textareaRef.current) {
          textareaRef.current.focus();
          if (moveCursorToEnd) {
            textareaRef.current.setSelectionRange(textareaRef.current.value.length, textareaRef.current.value.length);
          }
        }
      },
    }));

    // Auto-resize textarea
    const autoResize = () => {
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
        textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
      }
    };

    useEffect(() => {
      autoResize();
    }, [currentInput]);

    const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const rawValue = e.target.value;

      // Allow setting the value even if it's invalid (for better UX)
      setCurrentInput(rawValue);

      // Validate the input
      if (rawValue.trim()) {
        try {
          ValidationService.validateChatInput(rawValue);
          setValidationError(null);
        } catch (error) {
          setValidationError(error instanceof Error ? error.message : 'Invalid input');
        }
      } else {
        setValidationError(null);
      }

      autoResize();
    };

    const handleSendClick = () => {
      if (validationError) {
        return;
      }
      sendMessage();
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        if (validationError) {
          e.preventDefault();
        } else {
          handleKeyPress(e);
        }
      }
    };

    return (
      <div className="relative">
        {validationError && (
          <div className="mb-2">
            <Alert severity="error" title="Input validation error">
              {validationError}
            </Alert>
          </div>
        )}

        {/* Gradient border wrapper */}
        <div className={`gradient-border-wrapper ${validationError ? 'opacity-50' : ''}`}>
          <div
            className="gradient-border-inner px-5 py-4"
            style={{
              backgroundColor: theme.isDark ? '#1a1a1a' : theme.colors.background.primary,
            }}
          >
            {/* Top row: @ symbol and settings icon */}
            {/* <div className="flex items-center justify-between mb-3">
              <span className="text-base font-medium" style={{ color: theme.colors.text.secondary }}>
                @
              </span>
              <button
                type="button"
                className="p-1.5 rounded hover:bg-white/5 transition-colors"
                aria-label="Settings"
                style={{ color: theme.colors.text.secondary }}
              >
                <Icon name="cog" size="md" />
              </button>
            </div> */}

            {/* Text input area */}
            <textarea
              ref={textareaRef}
              value={currentInput}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder="Ask me anything about your metrics, logs, or observability..."
              disabled={isGenerating || toolsLoading}
              rows={1}
              className="w-full resize-none bg-transparent border-0 text-base placeholder-secondary focus:outline-none focus:ring-0 min-h-[28px] max-h-[200px]"
              style={{
                lineHeight: '1.6',
                height: 'auto',
                color: theme.colors.text.primary,
              }}
              aria-label="Chat input"
              aria-invalid={!!validationError}
              aria-describedby={validationError ? 'input-error' : undefined}
            />

            {/* Bottom row: Loading indicator and send/enter icon */}
            <div className="flex items-center justify-between mt-4 pt-3">
              <div className="flex items-center gap-3">
                {/* Left slot for optional actions */}
                {leftSlot}

                {/* Loading indicator */}
                {(isGenerating || toolsLoading) && (
                  <div className="flex items-center text-sm" style={{ color: theme.colors.text.secondary }}>
                    {isGenerating ? (
                      <>
                        <div className="flex gap-1 mr-2">
                          <div
                            className="w-1.5 h-1.5 bg-current rounded-full animate-pulse"
                            style={{ animationDelay: '0ms' }}
                          />
                          <div
                            className="w-1.5 h-1.5 bg-current rounded-full animate-pulse"
                            style={{ animationDelay: '150ms' }}
                          />
                          <div
                            className="w-1.5 h-1.5 bg-current rounded-full animate-pulse"
                            style={{ animationDelay: '300ms' }}
                          />
                        </div>
                        <span>Generating...</span>
                      </>
                    ) : (
                      <span>Loading tools...</span>
                    )}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-3">
                {/* Right slot for optional actions */}
                {rightSlot}

                {/* Enter/Send button */}
                <button
                  onClick={handleSendClick}
                  disabled={!currentInput.trim() || isGenerating || toolsLoading || !!validationError}
                  className="p-2 rounded-md hover:bg-white/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  aria-label="Send message (Enter)"
                  style={{ color: theme.colors.text.secondary }}
                >
                  <Icon name="enter" size="xl" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }
);

ChatInput.displayName = 'ChatInput';
