/**
 * Unit tests for useKeyboardNavigation hook
 * Tests keyboard shortcuts and navigation functionality
 */

import { renderHook, act } from '@testing-library/react';
import { useKeyboardNavigation, useAnnounce } from '../useKeyboardNavigation';

describe('useKeyboardNavigation', () => {
  let mockOnNewChat: jest.Mock;
  let mockOnClearChat: jest.Mock;
  let mockOnOpenHistory: jest.Mock;
  let mockOnFocusInput: jest.Mock;
  let mockOnToggleTheme: jest.Mock;
  let mockOnExportChat: jest.Mock;
  let mockOnSearch: jest.Mock;

  beforeEach(() => {
    mockOnNewChat = jest.fn();
    mockOnClearChat = jest.fn();
    mockOnOpenHistory = jest.fn();
    mockOnFocusInput = jest.fn();
    mockOnToggleTheme = jest.fn();
    mockOnExportChat = jest.fn();
    mockOnSearch = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  const createKeyboardEvent = (key: string, options: Partial<KeyboardEventInit> = {}): KeyboardEvent => {
    return new KeyboardEvent('keydown', {
      key,
      bubbles: true,
      ...options,
    });
  };

  describe('shortcuts return value', () => {
    it('should return shortcuts array', () => {
      const { result } = renderHook(() =>
        useKeyboardNavigation({
          onNewChat: mockOnNewChat,
        })
      );

      expect(result.current.shortcuts).toBeDefined();
      expect(result.current.shortcuts.length).toBeGreaterThan(0);
    });

    it('should include focus chat input shortcut', () => {
      const { result } = renderHook(() =>
        useKeyboardNavigation({})
      );

      const focusShortcut = result.current.shortcuts.find((s) => s.description === 'Focus chat input');
      expect(focusShortcut).toBeDefined();
      expect(focusShortcut?.keys).toContain('K');
    });

    it('should include new chat shortcut', () => {
      const { result } = renderHook(() =>
        useKeyboardNavigation({})
      );

      const newChatShortcut = result.current.shortcuts.find((s) => s.description === 'New chat');
      expect(newChatShortcut).toBeDefined();
      expect(newChatShortcut?.keys).toContain('N');
    });

    it('should include export chat shortcut', () => {
      const { result } = renderHook(() =>
        useKeyboardNavigation({})
      );

      const exportShortcut = result.current.shortcuts.find((s) => s.description === 'Export chat');
      expect(exportShortcut).toBeDefined();
    });

    it('should include search shortcut', () => {
      const { result } = renderHook(() =>
        useKeyboardNavigation({})
      );

      const searchShortcut = result.current.shortcuts.find((s) => s.description === 'Search in chat');
      expect(searchShortcut).toBeDefined();
    });

    it('should include all expected shortcuts', () => {
      const { result } = renderHook(() =>
        useKeyboardNavigation({})
      );

      const shortcutDescriptions = result.current.shortcuts.map((s) => s.description);

      expect(shortcutDescriptions).toContain('Focus chat input');
      expect(shortcutDescriptions).toContain('New chat');
      expect(shortcutDescriptions).toContain('Open history');
      expect(shortcutDescriptions).toContain('Export chat');
      expect(shortcutDescriptions).toContain('Search in chat');
      expect(shortcutDescriptions).toContain('Clear chat');
      expect(shortcutDescriptions).toContain('Close dialog');
      expect(shortcutDescriptions).toContain('Navigate elements');
      expect(shortcutDescriptions).toContain('Navigate messages');
    });
  });

  describe('keyboard event handling', () => {
    it('should add keydown event listener on mount', () => {
      const addEventListenerSpy = jest.spyOn(window, 'addEventListener');

      renderHook(() =>
        useKeyboardNavigation({
          onNewChat: mockOnNewChat,
        })
      );

      expect(addEventListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function));

      addEventListenerSpy.mockRestore();
    });

    it('should remove keydown event listener on unmount', () => {
      const removeEventListenerSpy = jest.spyOn(window, 'removeEventListener');

      const { unmount } = renderHook(() =>
        useKeyboardNavigation({
          onNewChat: mockOnNewChat,
        })
      );

      unmount();

      expect(removeEventListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function));

      removeEventListenerSpy.mockRestore();
    });

    it('should call onFocusInput on Cmd+K', () => {
      renderHook(() =>
        useKeyboardNavigation({
          onFocusInput: mockOnFocusInput,
        })
      );

      act(() => {
        window.dispatchEvent(createKeyboardEvent('k', { metaKey: true }));
      });

      expect(mockOnFocusInput).toHaveBeenCalled();
    });

    it('should call onFocusInput on Ctrl+K', () => {
      renderHook(() =>
        useKeyboardNavigation({
          onFocusInput: mockOnFocusInput,
        })
      );

      act(() => {
        window.dispatchEvent(createKeyboardEvent('k', { ctrlKey: true }));
      });

      expect(mockOnFocusInput).toHaveBeenCalled();
    });

    it('should call onNewChat on Cmd+N', () => {
      renderHook(() =>
        useKeyboardNavigation({
          onNewChat: mockOnNewChat,
        })
      );

      act(() => {
        window.dispatchEvent(createKeyboardEvent('n', { metaKey: true }));
      });

      expect(mockOnNewChat).toHaveBeenCalled();
    });

    it('should call onOpenHistory on Cmd+H', () => {
      renderHook(() =>
        useKeyboardNavigation({
          onOpenHistory: mockOnOpenHistory,
        })
      );

      act(() => {
        window.dispatchEvent(createKeyboardEvent('h', { metaKey: true }));
      });

      expect(mockOnOpenHistory).toHaveBeenCalled();
    });

    it('should call onExportChat on Cmd+E', () => {
      renderHook(() =>
        useKeyboardNavigation({
          onExportChat: mockOnExportChat,
        })
      );

      act(() => {
        window.dispatchEvent(createKeyboardEvent('e', { metaKey: true }));
      });

      expect(mockOnExportChat).toHaveBeenCalled();
    });

    it('should call onSearch on Cmd+F', () => {
      renderHook(() =>
        useKeyboardNavigation({
          onSearch: mockOnSearch,
        })
      );

      act(() => {
        window.dispatchEvent(createKeyboardEvent('f', { metaKey: true }));
      });

      expect(mockOnSearch).toHaveBeenCalled();
    });

    it('should call onClearChat on Cmd+Shift+Delete', () => {
      renderHook(() =>
        useKeyboardNavigation({
          onClearChat: mockOnClearChat,
        })
      );

      act(() => {
        window.dispatchEvent(createKeyboardEvent('Delete', { metaKey: true, shiftKey: true }));
      });

      expect(mockOnClearChat).toHaveBeenCalled();
    });

    it('should call onToggleTheme on Cmd+Shift+T', () => {
      renderHook(() =>
        useKeyboardNavigation({
          onToggleTheme: mockOnToggleTheme,
        })
      );

      act(() => {
        window.dispatchEvent(createKeyboardEvent('T', { metaKey: true, shiftKey: true }));
      });

      expect(mockOnToggleTheme).toHaveBeenCalled();
    });

    it('should not call callbacks when only modifier key is pressed', () => {
      renderHook(() =>
        useKeyboardNavigation({
          onNewChat: mockOnNewChat,
          onFocusInput: mockOnFocusInput,
        })
      );

      act(() => {
        window.dispatchEvent(createKeyboardEvent('Meta', { metaKey: true }));
      });

      expect(mockOnNewChat).not.toHaveBeenCalled();
      expect(mockOnFocusInput).not.toHaveBeenCalled();
    });

    it('should not call callbacks when random key without modifier is pressed', () => {
      renderHook(() =>
        useKeyboardNavigation({
          onNewChat: mockOnNewChat,
        })
      );

      act(() => {
        window.dispatchEvent(createKeyboardEvent('a', {}));
      });

      expect(mockOnNewChat).not.toHaveBeenCalled();
    });
  });
});

describe('useAnnounce', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('should return announce function', () => {
    const { result } = renderHook(() => useAnnounce());
    expect(typeof result.current).toBe('function');
  });

  it('should create announcement element with polite aria-live by default', () => {
    const { result } = renderHook(() => useAnnounce());

    act(() => {
      result.current('Test announcement');
    });

    const announcement = document.querySelector('[role="status"]');
    expect(announcement).not.toBeNull();
    expect(announcement?.getAttribute('aria-live')).toBe('polite');
    expect(announcement?.textContent).toBe('Test announcement');
  });

  it('should create announcement element with assertive aria-live when specified', () => {
    const { result } = renderHook(() => useAnnounce());

    act(() => {
      result.current('Urgent announcement', 'assertive');
    });

    const announcement = document.querySelector('[role="status"]');
    expect(announcement?.getAttribute('aria-live')).toBe('assertive');
  });

  it('should set aria-atomic to true', () => {
    const { result } = renderHook(() => useAnnounce());

    act(() => {
      result.current('Test');
    });

    const announcement = document.querySelector('[role="status"]');
    expect(announcement?.getAttribute('aria-atomic')).toBe('true');
  });

  it('should remove announcement after timeout', async () => {
    jest.useFakeTimers();

    const { result } = renderHook(() => useAnnounce());

    act(() => {
      result.current('Temporary announcement');
    });

    expect(document.querySelector('[role="status"]')).not.toBeNull();

    act(() => {
      jest.advanceTimersByTime(1000);
    });

    expect(document.querySelector('[role="status"]')).toBeNull();

    jest.useRealTimers();
  });

  it('should position announcement off-screen for screen readers', () => {
    const { result } = renderHook(() => useAnnounce());

    act(() => {
      result.current('Hidden announcement');
    });

    const announcement = document.querySelector('[role="status"]') as HTMLElement;
    expect(announcement.style.position).toBe('absolute');
    expect(announcement.style.left).toBe('-10000px');
  });
});

