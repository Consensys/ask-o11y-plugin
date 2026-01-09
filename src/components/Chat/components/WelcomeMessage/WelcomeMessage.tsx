import React from 'react';
import { useTheme2 } from '@grafana/ui';

// Sparkle SVG icon component matching Grafana's style
const SparkleIcon: React.FC<{ className?: string; style?: React.CSSProperties }> = ({ className, style }) => (
  <svg
    className={className}
    style={style}
    width="44"
    height="44"
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M12 2L13.09 8.26L18 6L14.74 10.91L21 12L14.74 13.09L18 18L13.09 15.74L12 22L10.91 15.74L6 18L9.26 13.09L3 12L9.26 10.91L6 6L10.91 8.26L12 2Z"
      fill="currentColor"
    />
  </svg>
);

export const WelcomeMessage: React.FC = () => {
  const theme = useTheme2();

  return (
    <div className="text-center animate-fadeIn flex flex-col items-center justify-center py-8">
      {/* "Hi, I'm" text */}
      <p className="text-base mb-2" style={{ color: theme.colors.text.secondary }}>
        Hi, I&apos;m
      </p>

      {/* Title with sparkle icon */}
      <div className="flex items-center justify-center gap-3 mb-5">
        <SparkleIcon className="animate-sparkle" style={{ color: theme.colors.text.primary }} />
        <h1 className="text-5xl font-bold tracking-tight" style={{ color: theme.colors.text.primary }}>
          Ask O11y Assistant
        </h1>
      </div>

      {/* Status badge and version */}
      <div className="flex items-center gap-3 mb-8">
        <span className="status-badge">BETA</span>
        <span className="text-base" style={{ color: theme.colors.text.secondary }}>
          v0.2.0
        </span>
      </div>

      {/* Description with highlighted text */}
      <p className="text-lg max-w-2xl mx-auto leading-relaxed" style={{ color: theme.colors.text.secondary }}>
        An{' '}
        <span className="font-medium" style={{ color: '#f97316' }}>
          agentic LLM assistant
        </span>{' '}
        for Grafana that helps you query data, investigate issues, manage dashboards, and more through natural language.
      </p>
    </div>
  );
};
