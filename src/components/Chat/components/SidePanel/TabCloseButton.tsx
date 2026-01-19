import React from 'react';

export interface TabCloseButtonProps {
  onClick: () => void;
  color: string;
}

export const TabCloseButton: React.FC<TabCloseButtonProps> = ({ onClick, color }) => {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="p-1 mr-1 rounded hover:bg-black/20 transition-colors flex-shrink-0"
      style={{ color }}
      aria-label="Close tab"
      title="Close tab"
    >
      <svg
        width="10"
        height="10"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    </button>
  );
};

