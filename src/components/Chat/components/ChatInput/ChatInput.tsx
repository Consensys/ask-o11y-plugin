import React, { forwardRef, useImperativeHandle, useRef, useEffect, useState } from 'react';
import { Icon, Alert, useStyles2, useTheme2 } from '@grafana/ui';
import { css, cx, keyframes } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { ValidationService } from '../../../../services/validation';

interface ChatInputProps {
  currentInput: string;
  isGenerating: boolean;
  setCurrentInput: (value: string) => void;
  sendMessage: () => void;
  handleKeyPress: (e: React.KeyboardEvent) => void;
  rightSlot?: React.ReactNode;
  leftSlot?: React.ReactNode;
  queuedMessageCount: number;
  onStopGeneration?: () => void;
}

export interface ChatInputRef {
  focus: () => void;
  clear: () => void;
}

export const ChatInput = forwardRef<ChatInputRef, ChatInputProps>(
  (
    { currentInput, isGenerating, setCurrentInput, sendMessage, handleKeyPress, rightSlot, leftSlot, queuedMessageCount, onStopGeneration },
    ref
  ) => {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const [validationError, setValidationError] = useState<string | null>(null);
    const theme = useTheme2();
    const styles = useStyles2(getStyles);
    const isComposingRef = useRef(false);

    useImperativeHandle(ref, () => ({
      focus: () => {
        if (textareaRef.current) {
          textareaRef.current.focus();
        }
      },
      clear: () => {
        if (textareaRef.current) {
          textareaRef.current.value = '';
          autoResize();
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

    // Sync external changes to textarea (e.g., from suggestion clicks, clearing chat)
    useEffect(() => {
      if (textareaRef.current) {
        // Always sync, even if value appears the same (handles edge cases like clearing after send)
        textareaRef.current.value = currentInput;
        autoResize();
      }
    }, [currentInput]);

    const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const rawValue = e.target.value;

      // Don't update state during composition (IME input)
      if (isComposingRef.current) {
        return;
      }

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
        <div className={cx(styles.gradientWrapper, styles.gradientGlow, validationError && 'opacity-50')}>
          <div className={cx(styles.gradientInner, 'px-5 py-4')}>
            <textarea
              ref={textareaRef}
              defaultValue={currentInput}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              onCompositionStart={() => { isComposingRef.current = true; }}
              onCompositionEnd={(e) => {
                isComposingRef.current = false;
                handleInputChange(e as any);
              }}
              placeholder="Ask me anything about your metrics, logs, or observability..."
              rows={1}
              className="w-full resize-none bg-transparent border-0 text-base placeholder-secondary focus:outline-none focus:ring-0 min-h-[28px] max-h-[200px]"
              style={{
                lineHeight: '1.6',
                height: 'auto',
                color: theme.colors.text.primary,
              }}
              aria-label={isGenerating ? 'Chat input (message will be queued)' : 'Chat input'}
              aria-invalid={!!validationError}
              aria-describedby={validationError ? 'input-error' : undefined}
            />

            {/* Bottom row: Loading indicator and send/enter icon */}
            <div className="flex items-center justify-between mt-4 pt-3">
              <div className="flex items-center gap-3">
                {/* Left slot for optional actions */}
                {leftSlot}

                {/* Loading indicator */}
                {isGenerating && (
                  <div className="flex items-center text-sm" style={{ color: theme.colors.text.secondary }}>
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
                  </div>
                )}

                {queuedMessageCount > 0 && (
                  <div
                    className="flex items-center text-xs px-2 py-1 rounded-full border border-weak bg-surface"
                    aria-label={`${queuedMessageCount} message${queuedMessageCount > 1 ? 's' : ''} queued — will be sent after current response completes`}
                    data-testid="chat-queue-indicator"
                  >
                    <Icon name="clock-nine" size="xs" className="mr-1" />
                    <span>{queuedMessageCount} queued — will send after response</span>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-3">
                {/* Right slot for optional actions */}
                {rightSlot}

                {isGenerating && onStopGeneration && (
                  <button
                    onClick={onStopGeneration}
                    className={cx('p-2 rounded-md transition-colors', styles.hoverButton)}
                    aria-label="Stop generating"
                    title="Stop generating"
                    data-testid="chat-stop-button"
                    style={{ color: theme.colors.text.secondary }}
                  >
                    <Icon name="square-shape" size="lg" />
                  </button>
                )}

                {/* Enter/Send button */}
                <button
                  onClick={handleSendClick}
                  disabled={!currentInput.trim() || !!validationError}
                  className={cx('p-2 rounded-md transition-colors disabled:opacity-30 disabled:cursor-not-allowed', styles.hoverButton)}
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

const getStyles = (theme: GrafanaTheme2) => {
  const gradientShift = keyframes({
    '0%': { backgroundPosition: '0% 50%' },
    '50%': { backgroundPosition: '100% 50%' },
    '100%': { backgroundPosition: '0% 50%' },
  });

  const gradient = `linear-gradient(90deg, ${theme.colors.primary.main}, ${theme.colors.error.main}, ${theme.colors.warning.main}, ${theme.colors.error.main}, ${theme.colors.primary.main})`;

  return {
    gradientWrapper: css({
      position: 'relative',
      borderRadius: theme.shape.radius.default,
      padding: 2,
      background: gradient,
      backgroundSize: '200% 100%',
      animation: `${gradientShift} 4s ease infinite`,
    }),
    gradientGlow: css({
      '&::before': {
        content: '""',
        position: 'absolute',
        inset: -2,
        borderRadius: theme.shape.radius.default,
        background: gradient,
        backgroundSize: '200% 100%',
        animation: `${gradientShift} 4s ease infinite`,
        filter: 'blur(8px)',
        opacity: 0.5,
        zIndex: -1,
      },
    }),
    gradientInner: css({
      backgroundColor: theme.colors.background.canvas,
      borderRadius: theme.shape.radius.default,
      position: 'relative',
      zIndex: 1,
    }),
    hoverButton: css({
      '&:hover': {
        backgroundColor: theme.colors.action.hover,
      },
    }),
  };
};
