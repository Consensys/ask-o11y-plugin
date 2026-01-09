import React, { useState } from 'react';
import { useTheme2 } from '@grafana/ui';

interface ToolCallDisplayProps {
  toolCall: {
    name: string;
    arguments: string;
    running: boolean;
    error?: string;
    response?: any;
  };
}

// Checkmark icon
const CheckIcon: React.FC<{ size?: number }> = ({ size = 14 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

// X icon for errors
const XIcon: React.FC<{ size?: number }> = ({ size = 14 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

// Spinner for running
const SpinnerIcon: React.FC<{ size?: number }> = ({ size = 14 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="animate-spin"
  >
    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
  </svg>
);

export const ToolCallDisplay: React.FC<ToolCallDisplayProps> = ({ toolCall }) => {
  const theme = useTheme2();
  const [isExpanded, setIsExpanded] = useState(false);

  const formatInlineArguments = (args: string) => {
    try {
      const parsed = JSON.parse(args);
      const keys = Object.keys(parsed);
      if (keys.length === 0) {
        return '';
      }
      if (keys.length === 1) {
        const value = JSON.stringify(parsed[keys[0]]);
        return value.length > 40 ? `${keys[0]}: ${value.substring(0, 40)}...` : `${keys[0]}: ${value}`;
      }
      return `${keys.length} params`;
    } catch {
      return args.length > 40 ? args.substring(0, 40) + '...' : args;
    }
  };

  const formatFullArguments = (args: string) => {
    try {
      const parsed = JSON.parse(args);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return args;
    }
  };

  const getStatusConfig = (running: boolean, error?: string) => {
    if (error) {
      return {
        icon: <XIcon size={12} />,
        color: '#ef4444',
      };
    }
    if (running) {
      return {
        icon: <SpinnerIcon size={12} />,
        color: '#fbbf24',
      };
    }
    return {
      icon: <CheckIcon size={12} />,
      color: '#22c55e',
    };
  };

  const status = getStatusConfig(toolCall.running, toolCall.error);
  const inlineArgs = formatInlineArguments(toolCall.arguments);
  const hasArgs = toolCall.arguments && toolCall.arguments !== '{}';
  const canExpand = hasArgs && toolCall.arguments.length > 50;

  return (
    <div
      className="group rounded-lg transition-all duration-200"
      style={{
        backgroundColor: theme.isDark ? 'rgba(255, 255, 255, 0.02)' : 'rgba(0, 0, 0, 0.01)',
        border: `1px solid ${theme.isDark ? 'rgba(255, 255, 255, 0.04)' : 'rgba(0, 0, 0, 0.04)'}`,
      }}
    >
      {/* Main row */}
      <div
        className={`flex items-center gap-3 px-3 py-2.5 ${canExpand ? 'cursor-pointer' : ''}`}
        onClick={canExpand ? () => setIsExpanded(!isExpanded) : undefined}
      >
        {/* Status icon */}
        <div className="flex-shrink-0 w-5 h-5 rounded flex items-center justify-center" style={{ color: status.color }}>
          {status.icon}
        </div>

        {/* Tool name and args */}
        <div className="flex-1 min-w-0 flex items-center gap-2">
          <span
            className="font-mono text-xs font-medium truncate"
            style={{ color: theme.colors.text.primary }}
            title={toolCall.name}
          >
            {toolCall.name}
          </span>
          {hasArgs && (
            <span className="font-mono text-xs truncate" style={{ color: theme.colors.text.secondary }}>
              {inlineArgs}
            </span>
          )}
        </div>

        {/* Expand indicator */}
        {canExpand && (
          <div
            className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
            style={{ color: theme.colors.text.secondary }}
          >
            <svg
              width="14"
              height="14"
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
          </div>
        )}
      </div>

      {/* Expanded arguments */}
      {isExpanded && hasArgs && (
        <div
          className="mx-3 mb-3 p-2.5 rounded-md font-mono text-xs overflow-x-auto"
          style={{
            backgroundColor: theme.isDark ? 'rgba(0, 0, 0, 0.3)' : 'rgba(0, 0, 0, 0.03)',
            color: theme.colors.text.secondary,
          }}
        >
          <pre className="whitespace-pre-wrap break-words m-0 leading-relaxed">
            {formatFullArguments(toolCall.arguments)}
          </pre>
        </div>
      )}

      {/* Error display */}
      {toolCall.error && (
        <div
          className="mx-3 mb-3 p-2.5 rounded-md"
          style={{
            backgroundColor: theme.isDark ? 'rgba(239, 68, 68, 0.1)' : 'rgba(239, 68, 68, 0.05)',
            border: `1px solid ${theme.isDark ? 'rgba(239, 68, 68, 0.2)' : 'rgba(239, 68, 68, 0.15)'}`,
          }}
        >
          <div className="flex items-start gap-2">
            <span style={{ color: '#ef4444' }}>
              <XIcon size={12} />
            </span>
            <pre
              className="text-xs font-mono whitespace-pre-wrap break-words m-0 flex-1"
              style={{ color: theme.colors.text.secondary }}
            >
              {toolCall.error}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
};
