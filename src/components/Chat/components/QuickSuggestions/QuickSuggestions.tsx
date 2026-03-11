import React from 'react';
import { useStyles2 } from '@grafana/ui';
import { css, cx } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';

interface QuickSuggestionsProps {
  onSuggestionClick?: (message: string) => void;
}

const suggestions = [
  {
    label: 'Show me a graph of CPU usage',
    message: 'Show me a graph of CPU usage over time',
    icon: '📊',
  },
  {
    label: 'Graph memory by pod',
    message: 'Graph memory usage by pod in my default namespace',
    icon: '💾',
  },
  {
    label: 'Monitor user activity',
    message: 'Create a query to monitor user activity over the last 24 hours',
    icon: '🔍',
  },
  {
    label: 'Build a dashboard',
    message: 'Help me build a dashboard for system performance metrics',
    icon: '🎯',
  },
];

export const QuickSuggestions: React.FC<QuickSuggestionsProps> = ({ onSuggestionClick }) => {
  const styles = useStyles2(getStyles);

  return (
    <div className="mt-8 animate-fadeIn" style={{ animationDelay: '200ms' }}>
      <p className={cx('text-center text-sm mb-4', styles.label)}>
        Quick start suggestions
      </p>

      <div className="flex flex-wrap justify-center gap-3">
        {suggestions.map((suggestion, index) => (
          <button
            key={index}
            onClick={() => onSuggestionClick?.(suggestion.message)}
            className={cx('group inline-flex items-center gap-2.5 px-5 py-3 rounded-xl text-base cursor-pointer transition-all duration-300 hover:-translate-y-1 hover:shadow-lg', styles.pill)}
            style={{ animationDelay: `${(index + 1) * 50}ms` }}
          >
            <span className="text-lg transition-transform duration-300 group-hover:scale-110">{suggestion.icon}</span>
            <span className="font-medium">{suggestion.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
};

const getStyles = (theme: GrafanaTheme2) => ({
  label: css({
    color: theme.colors.text.secondary,
  }),
  pill: css({
    backgroundColor: theme.colors.action.hover,
    border: `1px solid ${theme.colors.border.weak}`,
    color: theme.colors.text.primary,
    '&:hover': {
      borderColor: theme.colors.primary.main,
      backgroundColor: theme.colors.primary.transparent,
    },
  }),
});
