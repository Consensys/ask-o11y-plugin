import React from 'react';
import { useTheme2 } from '@grafana/ui';

interface EmbeddingDisabledPanelProps {
  onClose: () => void;
}

export const EmbeddingDisabledPanel: React.FC<EmbeddingDisabledPanelProps> = ({ onClose }) => {
  const theme = useTheme2();

  return (
    <div
      className="flex flex-col h-screen sticky top-0 border-r transition-all duration-300 ease-in-out"
      style={{
        width: '800px',
        minWidth: '400px',
        maxWidth: '65%',
        backgroundColor: theme.isDark ? '#1a1b1f' : theme.colors.background.primary,
        borderColor: theme.colors.border.weak,
      }}
      role="complementary"
      aria-label="Grafana page preview"
    >
      <div
        className="flex items-center justify-between px-4 py-3 border-b flex-shrink-0"
        style={{
          borderColor: theme.colors.border.weak,
          backgroundColor: theme.isDark ? '#111217' : theme.colors.background.secondary,
        }}
      >
        <div className="flex items-center gap-2">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ color: theme.colors.text.secondary }}
          >
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <line x1="9" y1="3" x2="9" y2="21" />
          </svg>
          <span className="text-sm font-medium" style={{ color: theme.colors.text.primary }}>
            Preview unavailable
          </span>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-md hover:bg-white/10 transition-colors"
          aria-label="Close panel"
          title="Close panel"
          style={{ color: theme.colors.text.secondary }}
        >
          <svg
            width="16"
            height="16"
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
      </div>
      <div
        className="flex-1 flex items-center justify-center px-6 text-sm text-center"
        style={{ color: theme.colors.text.secondary, backgroundColor: theme.colors.background.canvas }}
        aria-live="polite"
      >
        <div className="max-w-md space-y-2">
          <div className="font-medium" style={{ color: theme.colors.text.primary }}>
            Embedding is disabled in Grafana.
          </div>
          <div>
            Set the Grafana environment variable <code>GF_SECURITY_ALLOW_EMBEDDING=true</code> and reload to enable side
            panel previews.{' '}
            <a
              href="https://grafana.com/docs/grafana/latest/setup-grafana/configure-grafana/#allow_embedding"
              target="_blank"
              rel="noreferrer"
              className="text-link"
            >
              Learn more
            </a>
            .
          </div>
        </div>
      </div>
    </div>
  );
};
