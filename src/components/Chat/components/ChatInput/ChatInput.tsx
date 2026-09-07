import React, { forwardRef, useImperativeHandle, useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Icon, Alert, useStyles2, useTheme2 } from '@grafana/ui';
import { css, cx, keyframes } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { ValidationService } from '../../../../services/validation';
import { getHoverButtonStyle } from '../../../../theme';
import { testIds } from '../../../testIds';
import type { SkillCommand } from '../../../../services/skillsClient';

const TEXTAREA_MAX_ROWS = 25;
const MAX_SLASH_MENU_ITEMS = 8;

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
  /** Pickable skills offered as /name slash commands. */
  skillCommands?: SkillCommand[];
}

export interface ChatInputRef {
  focus: () => void;
  clear: () => void;
}

/** Matches an unfinished slash command being typed: '/' plus name chars, no space yet. */
const OPEN_SLASH_PATTERN = /^\/[a-z0-9-]*$/i;
/** Matches a committed slash command: '/' plus a full name followed by whitespace or end. */
const COMMITTED_SLASH_PATTERN = /^\/([a-z0-9-]+)(?:\s|$)/i;

export const ChatInput = forwardRef<ChatInputRef, ChatInputProps>(
  (
    {
      currentInput,
      isGenerating,
      setCurrentInput,
      sendMessage,
      handleKeyPress,
      rightSlot,
      leftSlot,
      queuedMessageCount,
      onStopGeneration,
      skillCommands = [],
    },
    ref
  ) => {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    // The visible input box (gradient wrapper) anchors the slash menu.
    const inputBoxRef = useRef<HTMLDivElement | null>(null);
    const slashMenuRef = useRef<HTMLDivElement | null>(null);
    const [validationError, setValidationError] = useState<string | null>(null);
    const [slashDismissed, setSlashDismissed] = useState(false);
    const [activeSlashIndex, setActiveSlashIndex] = useState(0);
    // Viewport coordinates for the portal-rendered menu (fixed positioning
    // escapes the overflow:hidden wrappers around the chat input area).
    const [menuAnchor, setMenuAnchor] = useState<{ bottom: number; left: number; width: number } | null>(null);
    const theme = useTheme2();
    const styles = useStyles2(getStyles);
    const isComposingRef = useRef(false);
    const maxTextareaHeight = theme.spacing(TEXTAREA_MAX_ROWS);

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
    const autoResize = useCallback(() => {
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
        textareaRef.current.style.height = `${Math.min(
          textareaRef.current.scrollHeight,
          parseFloat(maxTextareaHeight)
        )}px`;
      }
    }, [maxTextareaHeight]);

    // Sync external changes to textarea (e.g., from suggestion clicks, clearing chat)
    useEffect(() => {
      if (textareaRef.current) {
        // Always sync, even if value appears the same (handles edge cases like clearing after send)
        textareaRef.current.value = currentInput;
        autoResize();
      }
    }, [autoResize, currentInput]);

    // Re-open the menu whenever the slash token changes after a dismissal.
    useEffect(() => {
      setSlashDismissed(false);
    }, [currentInput]);

    const slashMatches = useMemo(() => {
      if (skillCommands.length === 0 || slashDismissed || !OPEN_SLASH_PATTERN.test(currentInput)) {
        return [];
      }
      const token = currentInput.slice(1).toLowerCase();
      return skillCommands
        .filter((command) => command.name.startsWith(token))
        .slice(0, MAX_SLASH_MENU_ITEMS);
    }, [skillCommands, slashDismissed, currentInput]);

    useEffect(() => {
      setActiveSlashIndex((prev) => Math.min(prev, Math.max(slashMatches.length - 1, 0)));
    }, [slashMatches.length]);

    const slashMenuOpen = slashMatches.length > 0;

    // Measure the input box while the menu is open so the portal-rendered
    // menu can float right above it. Re-measured on input changes (the
    // textarea auto-resizes) and window resizes.
    useEffect(() => {
      if (!slashMenuOpen) {
        setMenuAnchor(null);
        return;
      }
      const measure = () => {
        const box = inputBoxRef.current;
        if (!box) {
          return;
        }
        const rect = box.getBoundingClientRect();
        setMenuAnchor({ bottom: window.innerHeight - rect.top + 8, left: rect.left, width: rect.width });
      };
      measure();
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }, [slashMenuOpen, currentInput]);

    // Dismiss when clicking outside the menu and the input.
    useEffect(() => {
      if (!slashMenuOpen) {
        return;
      }
      const onPointerDown = (event: PointerEvent) => {
        const target = event.target as Node | null;
        if (!target) {
          return;
        }
        if (slashMenuRef.current?.contains(target) || textareaRef.current?.contains(target)) {
          return;
        }
        setSlashDismissed(true);
      };
      document.addEventListener('pointerdown', onPointerDown);
      return () => document.removeEventListener('pointerdown', onPointerDown);
    }, [slashMenuOpen]);

    // A complete, known /skill token at the start of the input — show the
    // activation chip once the command menu is no longer open.
    const committedSkill = useMemo(() => {
      if (skillCommands.length === 0 || slashMenuOpen) {
        return null;
      }
      const match = currentInput.match(COMMITTED_SLASH_PATTERN);
      const name = match?.[1]?.toLowerCase();
      if (name && skillCommands.some((command) => command.name === name)) {
        return name;
      }
      return null;
    }, [skillCommands, slashMenuOpen, currentInput]);

    const completeSlashCommand = useCallback(
      (name: string) => {
        setSlashDismissed(true);
        setCurrentInput(`/${name} `);
        textareaRef.current?.focus();
      },
      [setCurrentInput]
    );

    const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const rawValue = e.target.value;

      // Don't update state during composition (IME input)
      if (isComposingRef.current) {
        return;
      }

      // Allow setting the value even if invalid (for better UX)
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

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (slashMenuOpen) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setActiveSlashIndex((prev) => (prev + 1) % slashMatches.length);
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setActiveSlashIndex((prev) => (prev - 1 + slashMatches.length) % slashMatches.length);
          return;
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault();
          const selected = slashMatches[activeSlashIndex];
          if (selected) {
            completeSlashCommand(selected.name);
          }
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          setSlashDismissed(true);
          return;
        }
      }

      if (e.key === 'Enter' && !e.shiftKey) {
        if (validationError) {
          e.preventDefault();
        } else {
          handleKeyPress(e);
        }
      }
    };

    const placeholder =
      skillCommands.length > 0
        ? 'Ask anything about your metrics, logs, or traces — or type / to pick a skill…'
        : 'Ask me anything about your metrics, logs, or observability...';

    return (
      <div className="relative">
        {validationError && (
          <div className="mb-2">
            <Alert severity="error" title="Input validation error">
              {validationError}
            </Alert>
          </div>
        )}

        {/* Slash command menu: portaled to the body with fixed positioning —
            the overflow:hidden wrappers around the chat input area would clip
            an in-flow menu floating above the input. Styling is entirely
            emotion-based: the served Tailwind build does not include all
            utilities (text-xs/truncate/fixed were missing). */}
        {slashMenuOpen &&
          menuAnchor &&
          createPortal(
            <div
              ref={slashMenuRef}
              className={styles.slashMenu}
              style={{
                position: 'fixed',
                bottom: `${menuAnchor.bottom}px`,
                left: `${menuAnchor.left}px`,
                width: `${menuAnchor.width}px`,
                maxHeight: `${Math.max(120, Math.min(280, menuAnchor.bottom - 16))}px`,
                zIndex: 1000,
              }}
              role="listbox"
              aria-label="Skill commands"
              data-testid={testIds.chat.skillCommandMenu}
            >
              {slashMatches.map((command, index) => (
                <button
                  key={command.name}
                  type="button"
                  role="option"
                  aria-selected={index === activeSlashIndex}
                  className={cx(styles.slashItem, index === activeSlashIndex && styles.slashItemActive)}
                  onMouseEnter={() => setActiveSlashIndex(index)}
                  onClick={() => completeSlashCommand(command.name)}
                  data-testid={testIds.chat.skillCommandItem(command.name)}
                >
                  <span className={styles.slashItemName}>/{command.name}</span>
                  <span className={styles.slashItemDescription}>{command.description}</span>
                </button>
              ))}
            </div>,
            document.body
          )}

        {/* Gradient border wrapper */}
        <div ref={inputBoxRef} className={cx(styles.gradientWrapper, styles.gradientGlow, validationError && 'opacity-50')}>
          <div className={cx(styles.gradientInner, 'px-5 py-4')}>
            {committedSkill && (
              <div className="flex items-center gap-2 mb-2" aria-label="Skill will be activated">
                <span
                  data-testid={testIds.chat.activeSkillHint(committedSkill)}
                  className={styles.skillChip}
                >
                  <Icon name="layer-group" size="xs" />
                  Skill: {committedSkill}
                </span>
              </div>
            )}

            <textarea
              ref={textareaRef}
              defaultValue={currentInput}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              onCompositionStart={() => {
                isComposingRef.current = true;
              }}
              onCompositionEnd={(e) => {
                isComposingRef.current = false;
                handleInputChange(e as any);
              }}
              placeholder={placeholder}
              rows={1}
              className={cx(
                'w-full resize-none bg-transparent border-0 text-base placeholder-secondary focus:outline-none focus:ring-0',
                styles.textarea
              )}
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
                    aria-label={`${queuedMessageCount} message${
                      queuedMessageCount > 1 ? 's' : ''
                    } queued — will be sent after current response completes`}
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
                  className={cx(
                    'p-2 rounded-md transition-colors disabled:opacity-30 disabled:cursor-not-allowed',
                    styles.hoverButton
                  )}
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
  const gradientInset = theme.spacing(0.25);
  const glowBlur = theme.spacing(1);
  const outerRadius = theme.shape.radius.default;
  const innerRadius = theme.shape.radius.sm;

  return {
    gradientWrapper: css({
      position: 'relative',
      borderRadius: outerRadius,
      padding: gradientInset,
      background: gradient,
      backgroundSize: '200% 100%',
      animation: `${gradientShift} 4s ease infinite`,
    }),
    gradientGlow: css({
      '&::before': {
        content: '""',
        position: 'absolute',
        inset: `calc(-1 * ${gradientInset})`,
        borderRadius: `calc(${outerRadius} + ${gradientInset})`,
        background: gradient,
        backgroundSize: '200% 100%',
        animation: `${gradientShift} 4s ease infinite`,
        filter: `blur(${glowBlur})`,
        opacity: 0.5,
        zIndex: -1,
      },
    }),
    gradientInner: css({
      backgroundColor: theme.colors.background.canvas,
      borderRadius: innerRadius,
      position: 'relative',
      zIndex: 1,
    }),
    textarea: css({
      minHeight: theme.spacing(3.5),
      maxHeight: theme.spacing(TEXTAREA_MAX_ROWS),
    }),
    slashMenu: css({
      backgroundColor: theme.colors.background.primary,
      border: `1px solid ${theme.colors.border.weak}`,
      borderRadius: theme.shape.radius.default,
      boxShadow: theme.shadows.z3,
      overflowY: 'auto',
      overflowX: 'hidden',
    }),
    slashItem: css({
      display: 'block',
      width: '100%',
      textAlign: 'left',
      padding: `${theme.spacing(1)} ${theme.spacing(1.5)}`,
      background: 'transparent',
      border: 0,
      cursor: 'pointer',
      '& + button': {
        borderTop: `1px solid ${theme.colors.border.weak}`,
      },
    }),
    slashItemActive: css({
      backgroundColor: theme.colors.action.hover,
    }),
    slashItemName: css({
      display: 'block',
      fontFamily: theme.typography.fontFamilyMonospace,
      fontSize: theme.typography.bodySmall.fontSize,
      fontWeight: 500,
      color: theme.colors.text.primary,
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    }),
    slashItemDescription: css({
      display: 'block',
      marginTop: 2,
      fontSize: 12,
      lineHeight: 1.4,
      color: theme.colors.text.secondary,
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    }),
    skillChip: css({
      display: 'inline-flex',
      alignItems: 'center',
      gap: theme.spacing(0.5),
      padding: `${theme.spacing(0.25)} ${theme.spacing(1)}`,
      borderRadius: theme.shape.radius.pill,
      fontSize: 12,
      fontWeight: 500,
      backgroundColor: theme.colors.background.secondary,
      border: `1px solid ${theme.colors.border.weak}`,
      color: theme.colors.text.secondary,
    }),
    hoverButton: getHoverButtonStyle(theme),
  };
};
