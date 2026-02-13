import React, { useState } from 'react';
import { testIds } from '../../../testIds';

const BrainIcon: React.FC<{ size?: number }> = ({ size = 14 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M12 2a7 7 0 0 0-7 7c0 2.38 1.19 4.47 3 5.74V17a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-2.26c1.81-1.27 3-3.36 3-5.74a7 7 0 0 0-7-7z" />
    <path d="M9 21v1a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1v-1" />
    <path d="M10 17v-5" />
    <path d="M14 17v-5" />
  </svg>
);

const ChevronIcon: React.FC<{ size?: number; isExpanded: boolean }> = ({ size = 16, isExpanded }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={`transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
  >
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

interface ReasoningIndicatorProps {
  reasoning: string;
}

export const ReasoningIndicator: React.FC<ReasoningIndicatorProps> = ({ reasoning }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div
      className="rounded-xl overflow-hidden mb-4 transition-all duration-200 bg-surface border border-weak"
      data-testid={testIds.chat.reasoningIndicator}
    >
      <button
        className="w-full flex justify-between items-center px-4 py-3 transition-colors duration-200 bg-transparent hover:bg-background-secondary"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center animate-pulse bg-primary/10 text-primary">
            <BrainIcon />
          </div>
          <span className="text-sm font-medium text-primary">Thinking...</span>
        </div>
        <div className="text-secondary">
          <ChevronIcon isExpanded={isExpanded} />
        </div>
      </button>

      {isExpanded && (
        <div className="px-4 pb-3 pt-1 text-xs leading-relaxed max-h-48 overflow-y-auto whitespace-pre-wrap text-secondary">
          {reasoning}
        </div>
      )}
    </div>
  );
};
