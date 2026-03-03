import { useEffect, useCallback, RefObject } from 'react';

export function useKeyboardNavigation(containerRef: RefObject<HTMLElement>) {
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        return;
      }

      const isInputActive =
        document.activeElement?.tagName === 'INPUT' ||
        document.activeElement?.tagName === 'TEXTAREA' ||
        document.activeElement?.getAttribute('contenteditable') === 'true';

      if (event.key === 'Escape') {
        const modal = containerRef.current?.querySelector('[role="dialog"]');
        if (modal) {
          const closeButton = modal.querySelector('[aria-label*="Close"]') as HTMLElement;
          closeButton?.click();
        }
        return;
      }

      if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && !isInputActive && containerRef.current) {
        const messages = containerRef.current.querySelectorAll('[role="article"]');
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
    [containerRef]
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    container.addEventListener('keydown', handleKeyDown);
    return () => {
      container.removeEventListener('keydown', handleKeyDown);
    };
  }, [containerRef, handleKeyDown]);
}

export function useFocusTrap(containerRef: RefObject<HTMLElement>, isActive = true) {
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
        if (document.activeElement === firstElement) {
          lastElement.focus();
          e.preventDefault();
        }
      } else {
        if (document.activeElement === lastElement) {
          firstElement.focus();
          e.preventDefault();
        }
      }
    };

    container.addEventListener('keydown', handleTabKey);
    firstElement.focus();

    return () => {
      container.removeEventListener('keydown', handleTabKey);
    };
  }, [containerRef, isActive]);
}

