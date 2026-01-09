import React from 'react';
import { useTheme2 } from '@grafana/ui';

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
  const theme = useTheme2();

  return (
    <div className="mt-8 animate-fadeIn" style={{ animationDelay: '200ms' }}>
      {/* Section label */}
      <p className="text-center text-sm mb-4" style={{ color: theme.colors.text.secondary }}>
        Quick start suggestions
      </p>

      {/* Suggestion pills */}
      <div className="flex flex-wrap justify-center gap-3">
        {suggestions.map((suggestion, index) => (
          <button
            key={index}
            onClick={() => onSuggestionClick?.(suggestion.message)}
            className="group inline-flex items-center gap-2.5 px-5 py-3 rounded-xl text-base cursor-pointer transition-all duration-300 hover:-translate-y-1 hover:shadow-lg"
            style={{
              backgroundColor: theme.isDark ? 'rgba(255, 255, 255, 0.03)' : theme.colors.background.secondary,
              border: `1px solid ${theme.isDark ? 'rgba(255, 255, 255, 0.1)' : theme.colors.border.weak}`,
              color: theme.colors.text.primary,
              animationDelay: `${(index + 1) * 50}ms`,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = theme.isDark ? 'rgba(139, 92, 246, 0.5)' : theme.colors.primary.main;
              e.currentTarget.style.backgroundColor = theme.isDark
                ? 'rgba(139, 92, 246, 0.1)'
                : 'rgba(139, 92, 246, 0.05)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = theme.isDark ? 'rgba(255, 255, 255, 0.1)' : theme.colors.border.weak;
              e.currentTarget.style.backgroundColor = theme.isDark
                ? 'rgba(255, 255, 255, 0.03)'
                : theme.colors.background.secondary;
            }}
          >
            <span className="text-lg transition-transform duration-300 group-hover:scale-110">{suggestion.icon}</span>
            <span className="font-medium">{suggestion.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
};
