/**
 * Keyboard Navigation Hook
 * Provides keyboard shortcuts and navigation support for the chat interface
 */

import { useEffect, useCallback } from 'react';

interface KeyboardShortcuts {
  onNewChat?: () => void;
  onClearChat?: () => void;
  onOpenHistory?: () => void;
  onFocusInput?: () => void;
  onToggleTheme?: () => void;
  onExportChat?: () => void;
  onSearch?: () => void;
}

export function useKeyboardNavigation({
  onNewChat,
  onClearChat,
  onOpenHistory,
  onFocusInput,
  onToggleTheme,
  onExportChat,
  onSearch,
}: KeyboardShortcuts) {
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      // Check if user is typing in an input/textarea
      const isInputActive =
        document.activeElement?.tagName === 'INPUT' ||
        document.activeElement?.tagName === 'TEXTAREA' ||
        document.activeElement?.getAttribute('contenteditable') === 'true';

      // Global shortcuts (work even in inputs)
      if (event.key === 'Escape') {
        // Close any open modals or dialogs
        const modal = document.querySelector('[role="dialog"]');
        if (modal) {
          const closeButton = modal.querySelector('[aria-label*="Close"]') as HTMLElement;
          closeButton?.click();
        }
        return;
      }

      // Don't trigger shortcuts when typing
      if (isInputActive && !event.metaKey && !event.ctrlKey) {
        return;
      }

      // Cmd/Ctrl + K: Focus chat input
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault();
        onFocusInput?.();
        return;
      }

      // Cmd/Ctrl + N: New chat
      if ((event.metaKey || event.ctrlKey) && event.key === 'n') {
        event.preventDefault();
        onNewChat?.();
        return;
      }

      // Cmd/Ctrl + Shift + Delete: Clear chat
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key === 'Delete') {
        event.preventDefault();
        onClearChat?.();
        return;
      }

      // Cmd/Ctrl + H: Open history
      if ((event.metaKey || event.ctrlKey) && event.key === 'h') {
        event.preventDefault();
        onOpenHistory?.();
        return;
      }

      // Cmd/Ctrl + E: Export chat
      if ((event.metaKey || event.ctrlKey) && event.key === 'e') {
        event.preventDefault();
        onExportChat?.();
        return;
      }

      // Cmd/Ctrl + F: Search in chat
      if ((event.metaKey || event.ctrlKey) && event.key === 'f') {
        event.preventDefault();
        onSearch?.();
        return;
      }

      // Cmd/Ctrl + Shift + T: Toggle theme (if available)
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key === 'T') {
        event.preventDefault();
        onToggleTheme?.();
        return;
      }

      // Tab navigation for message list
      if (event.key === 'Tab' && !event.shiftKey && !isInputActive) {
        const focusableElements = document.querySelectorAll(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );

        if (focusableElements.length > 0) {
          const currentIndex = Array.from(focusableElements).indexOf(document.activeElement as Element);
          const nextIndex = (currentIndex + 1) % focusableElements.length;
          (focusableElements[nextIndex] as HTMLElement).focus();
          event.preventDefault();
        }
      }

      // Arrow key navigation for message list
      if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && !isInputActive) {
        const messages = document.querySelectorAll('[role="article"]');
        if (messages.length > 0) {
          const currentFocused = document.activeElement;
          const currentIndex = Array.from(messages).indexOf(currentFocused as Element);

          let nextIndex: number;
          if (event.key === 'ArrowUp') {
            nextIndex = currentIndex > 0 ? currentIndex - 1 : messages.length - 1;
          } else {
            nextIndex = currentIndex < messages.length - 1 ? currentIndex + 1 : 0;
          }

          (messages[nextIndex] as HTMLElement).focus();
          event.preventDefault();
        }
      }
    },
    [onNewChat, onClearChat, onOpenHistory, onFocusInput, onToggleTheme, onExportChat, onSearch]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleKeyDown]);

  // Return keyboard shortcut info for display
  return {
    shortcuts: [
      { keys: ['⌘', 'K'], description: 'Focus chat input', windows: ['Ctrl', 'K'] },
      { keys: ['⌘', 'N'], description: 'New chat', windows: ['Ctrl', 'N'] },
      { keys: ['⌘', 'H'], description: 'Open history', windows: ['Ctrl', 'H'] },
      { keys: ['⌘', 'E'], description: 'Export chat', windows: ['Ctrl', 'E'] },
      { keys: ['⌘', 'F'], description: 'Search in chat', windows: ['Ctrl', 'F'] },
      { keys: ['⌘', '⇧', 'Delete'], description: 'Clear chat', windows: ['Ctrl', 'Shift', 'Delete'] },
      { keys: ['Esc'], description: 'Close dialog', windows: ['Esc'] },
      { keys: ['Tab'], description: 'Navigate elements', windows: ['Tab'] },
      { keys: ['↑', '↓'], description: 'Navigate messages', windows: ['↑', '↓'] },
    ],
  };
}

/**
 * Hook for managing focus trap within a container
 */
export function useFocusTrap(containerRef: React.RefObject<HTMLElement>, isActive = true) {
  useEffect(() => {
    if (!isActive || !containerRef.current) {
      return;
    }

    const container = containerRef.current;
    const focusableElements = container.querySelectorAll(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );

    if (focusableElements.length === 0) {
      return;
    }

    const firstElement = focusableElements[0] as HTMLElement;
    const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement;

    const handleTabKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') {
        return;
      }

      if (e.shiftKey) {
        // Shift + Tab
        if (document.activeElement === firstElement) {
          lastElement.focus();
          e.preventDefault();
        }
      } else {
        // Tab
        if (document.activeElement === lastElement) {
          firstElement.focus();
          e.preventDefault();
        }
      }
    };

    container.addEventListener('keydown', handleTabKey);

    // Focus first element
    firstElement.focus();

    return () => {
      container.removeEventListener('keydown', handleTabKey);
    };
  }, [containerRef, isActive]);
}

/**
 * Hook for announcing changes to screen readers
 */
export function useAnnounce() {
  const announce = useCallback((message: string, priority: 'polite' | 'assertive' = 'polite') => {
    const announcement = document.createElement('div');
    announcement.setAttribute('role', 'status');
    announcement.setAttribute('aria-live', priority);
    announcement.setAttribute('aria-atomic', 'true');
    announcement.style.position = 'absolute';
    announcement.style.left = '-10000px';
    announcement.style.width = '1px';
    announcement.style.height = '1px';
    announcement.style.overflow = 'hidden';
    announcement.textContent = message;

    document.body.appendChild(announcement);

    setTimeout(() => {
      document.body.removeChild(announcement);
    }, 1000);
  }, []);

  return announce;
}
