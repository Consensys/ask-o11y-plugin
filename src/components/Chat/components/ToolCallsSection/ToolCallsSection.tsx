import React, { useState } from 'react';
import { useTheme2 } from '@grafana/ui';
import { ToolCallDisplay } from './ToolCallDisplay';

interface ToolCallsSectionProps {
  toolCalls: Array<{
    name: string;
    arguments: string;
    running: boolean;
    error?: string;
    response?: any;
  }>;
}

// Tool/Wrench SVG icon
const ToolIcon: React.FC<{ size?: number }> = ({ size = 18 }) => (
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
    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
  </svg>
);

// Chevron icon
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

export const ToolCallsSection: React.FC<ToolCallsSectionProps> = ({ toolCalls }) => {
  const theme = useTheme2();
  const [isExpanded, setIsExpanded] = useState(false);

  const runningCount = toolCalls.filter((tc) => tc.running).length;
  const completedCount = toolCalls.filter((tc) => !tc.running && !tc.error).length;
  const errorCount = toolCalls.filter((tc) => tc.error).length;

  if (!toolCalls || toolCalls.length === 0) {
    return null;
  }

  return (
    <div
      className="rounded-xl overflow-hidden mb-4 transition-all duration-200"
      style={{
        backgroundColor: theme.isDark ? 'rgba(255, 255, 255, 0.02)' : 'rgba(0, 0, 0, 0.02)',
        border: `1px solid ${theme.isDark ? 'rgba(255, 255, 255, 0.06)' : theme.colors.border.weak}`,
      }}
    >
      {/* Compact Header */}
      <button
        className="w-full flex justify-between items-center px-4 py-3 transition-colors duration-200"
        style={{
          backgroundColor: 'transparent',
        }}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-3">
          {/* Icon */}
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center"
            style={{
              backgroundColor: theme.isDark ? 'rgba(139, 92, 246, 0.15)' : 'rgba(139, 92, 246, 0.1)',
              color: '#a78bfa',
            }}
          >
            <ToolIcon size={14} />
          </div>

          {/* Title and count */}
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium" style={{ color: theme.colors.text.primary }}>
              Tool Execution
            </span>
            <span
              className="px-1.5 py-0.5 rounded text-xs font-medium"
              style={{
                backgroundColor: theme.isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.04)',
                color: theme.colors.text.secondary,
              }}
            >
              {toolCalls.length}
            </span>
          </div>

          {/* Status pills */}
          <div className="flex items-center gap-1.5">
            {runningCount > 0 && (
              <span
                className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
                style={{
                  backgroundColor: theme.isDark ? 'rgba(251, 191, 36, 0.15)' : 'rgba(251, 191, 36, 0.1)',
                  color: '#fbbf24',
                }}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
                {runningCount}
              </span>
            )}
            {completedCount > 0 && (
              <span
                className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
                style={{
                  backgroundColor: theme.isDark ? 'rgba(34, 197, 94, 0.15)' : 'rgba(34, 197, 94, 0.1)',
                  color: '#22c55e',
                }}
              >
                <span>✓</span>
                {completedCount}
              </span>
            )}
            {errorCount > 0 && (
              <span
                className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
                style={{
                  backgroundColor: theme.isDark ? 'rgba(239, 68, 68, 0.15)' : 'rgba(239, 68, 68, 0.1)',
                  color: '#ef4444',
                }}
              >
                <span>✕</span>
                {errorCount}
              </span>
            )}
          </div>
        </div>

        {/* Expand/Collapse */}
        <div style={{ color: theme.colors.text.secondary }}>
          <ChevronIcon isExpanded={isExpanded} />
        </div>
      </button>

      {/* Tool Calls List */}
      {isExpanded && (
        <div className="px-4 pb-3 pt-1 space-y-2">
          {toolCalls.map((toolCall, index) => (
            <ToolCallDisplay key={index} toolCall={toolCall} />
          ))}
        </div>
      )}
    </div>
  );
};
