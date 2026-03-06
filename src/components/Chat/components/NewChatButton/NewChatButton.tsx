import React, { useState, useRef, useEffect } from 'react';
import { useTheme2 } from '@grafana/ui';

interface NewChatButtonProps {
  onConfirm: () => void;
  isGenerating?: boolean;
}

export function NewChatButton({ onConfirm, isGenerating }: NewChatButtonProps): React.ReactElement {
  const theme = useTheme2();
  const [isOpen, setIsOpen] = useState(false);
  const popupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handleClickOutside(event: MouseEvent): void {
      if (popupRef.current && !popupRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  function handleConfirm(): void {
    onConfirm();
    setIsOpen(false);
  }

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="p-2 rounded-md hover:bg-white/10 transition-colors"
        aria-label="New chat"
        title="New chat"
        style={{ color: theme.colors.text.secondary }}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="12" y1="5" x2="12" y2="19"></line>
          <line x1="5" y1="12" x2="19" y2="12"></line>
        </svg>
      </button>

      {isOpen && (
        <div
          ref={popupRef}
          className="absolute bottom-full left-0 mb-2 w-48 p-3 rounded-lg shadow-xl border z-50 flex flex-col gap-2"
          style={{
            backgroundColor: theme.colors.background.primary,
            borderColor: theme.colors.border.weak,
          }}
        >
          <p className="text-xs font-medium mb-1" style={{ color: theme.colors.text.primary }}>
            {isGenerating ? 'This will stop the current response. Start a new chat?' : 'Start a new chat?'}
          </p>
          <div className="flex gap-2">
            <button
              onClick={handleConfirm}
              className="flex-1 px-2 py-1 text-xs rounded font-medium transition-colors"
              style={{
                backgroundColor: theme.colors.primary.main,
                color: theme.colors.text.primary,
              }}
            >
              Yes
            </button>
            <button
              onClick={() => setIsOpen(false)}
              className="flex-1 px-2 py-1 text-xs rounded font-medium transition-colors hover:bg-white/10"
              style={{
                color: theme.colors.text.secondary,
                border: `1px solid ${theme.colors.border.weak}`,
              }}
            >
              No
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
