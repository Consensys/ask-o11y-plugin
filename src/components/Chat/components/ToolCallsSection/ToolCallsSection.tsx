import React, { useState } from 'react';
import { Icon, useTheme2 } from '@grafana/ui';
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
              color: theme.colors.primary.text,
            }}
          >
            <Icon name="cog" size="sm" />
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
                className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium text-warning"
                style={{ backgroundColor: `color-mix(in srgb, ${theme.colors.warning.main} 15%, transparent)` }}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
                {runningCount}
              </span>
            )}
            {completedCount > 0 && (
              <span
                className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium text-success"
                style={{ backgroundColor: `color-mix(in srgb, ${theme.colors.success.main} 15%, transparent)` }}
              >
                <span>✓</span>
                {completedCount}
              </span>
            )}
            {errorCount > 0 && (
              <span
                className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium text-error"
                style={{ backgroundColor: `color-mix(in srgb, ${theme.colors.error.main} 15%, transparent)` }}
              >
                <span>✕</span>
                {errorCount}
              </span>
            )}
          </div>
        </div>

        {/* Expand/Collapse */}
        <div className={`text-secondary transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}>
          <Icon name="angle-down" size="md" />
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
