/**
 * Summarization Indicator Component
 * Shows visual feedback when the system is summarizing old messages to save context tokens
 */

import React from 'react';
import { InlineLoading, LoadingDots } from '../../../LoadingOverlay';
import { Icon } from '@grafana/ui';

interface SummarizationIndicatorProps {
  isSummarizing: boolean;
  hasSummary: boolean;
  messageCount?: number;
  className?: string;
}

export function SummarizationIndicator({
  isSummarizing,
  hasSummary,
  messageCount,
  className = '',
}: SummarizationIndicatorProps) {
  if (!isSummarizing && !hasSummary) {
    return null;
  }

  return (
    <div
      className={`px-4 py-3 bg-info-background border-l-4 border-info text-sm ${className}`}
      role="status"
      aria-live="polite"
      aria-label={isSummarizing ? 'Summarizing conversation' : 'Conversation has been summarized'}
    >
      {isSummarizing ? (
        <div className="flex items-center gap-3">
          <InlineLoading size="sm" />
          <div className="flex-1">
            <div className="font-medium text-info-text mb-1">Optimizing conversation memory...</div>
            <div className="text-xs text-secondary">
              Summarizing {messageCount ? `${messageCount} older messages` : 'older messages'} to preserve context while
              reducing token usage
            </div>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <Icon name="check-circle" className="text-info" />
          <div className="flex-1">
            <div className="font-medium text-info-text mb-1">Conversation optimized</div>
            <div className="text-xs text-secondary">
              Older messages have been summarized to maintain efficient context
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Minimal summarization badge for inline display
 */
export const SummarizationBadge: React.FC<{
  isActive: boolean;
  className?: string;
}> = ({ isActive, className = '' }) => {
  if (!isActive) {
    return null;
  }

  return (
    <div
      className={`inline-flex items-center gap-1.5 px-2 py-1 bg-info-background rounded-full text-xs ${className}`}
      role="status"
      aria-label="Summarizing conversation"
    >
      <LoadingDots size="sm" />
      <span className="font-medium text-info-text">Summarizing</span>
    </div>
  );
};
