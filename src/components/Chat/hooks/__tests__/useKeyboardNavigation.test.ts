import { renderHook, act } from '@testing-library/react';
import { useKeyboardNavigation } from '../useKeyboardNavigation';

describe('useKeyboardNavigation', () => {
  let container: HTMLDivElement;
  let containerRef: React.RefObject<HTMLDivElement>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    containerRef = { current: container };
  });

  afterEach(() => {
    document.body.removeChild(container);
    jest.clearAllMocks();
  });

  const createKeyboardEvent = (key: string, options: Partial<KeyboardEventInit> = {}): KeyboardEvent => {
    return new KeyboardEvent('keydown', {
      key,
      bubbles: true,
      ...options,
    });
  };

  it('should add keydown event listener on container mount', () => {
    const addEventListenerSpy = jest.spyOn(container, 'addEventListener');

    renderHook(() => useKeyboardNavigation(containerRef));

    expect(addEventListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function));

    addEventListenerSpy.mockRestore();
  });

  it('should remove keydown event listener on unmount', () => {
    const removeEventListenerSpy = jest.spyOn(container, 'removeEventListener');

    const { unmount } = renderHook(() => useKeyboardNavigation(containerRef));

    unmount();

    expect(removeEventListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function));

    removeEventListenerSpy.mockRestore();
  });

  it('should handle Escape to close dialog within container', () => {
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    const closeButton = document.createElement('button');
    closeButton.setAttribute('aria-label', 'Close');
    const clickSpy = jest.fn();
    closeButton.addEventListener('click', clickSpy);
    dialog.appendChild(closeButton);
    container.appendChild(dialog);

    renderHook(() => useKeyboardNavigation(containerRef));

    act(() => {
      container.dispatchEvent(createKeyboardEvent('Escape'));
    });

    expect(clickSpy).toHaveBeenCalled();
  });

  it('should not handle events from outside the container', () => {
    const outsideElement = document.createElement('div');
    document.body.appendChild(outsideElement);

    renderHook(() => useKeyboardNavigation(containerRef));

    act(() => {
      outsideElement.dispatchEvent(createKeyboardEvent('Escape'));
    });

    document.body.removeChild(outsideElement);
  });

  it('should not react to random key presses', () => {
    renderHook(() => useKeyboardNavigation(containerRef));

    act(() => {
      container.dispatchEvent(createKeyboardEvent('a', {}));
    });
  });
});
