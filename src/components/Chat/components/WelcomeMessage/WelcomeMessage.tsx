import React from 'react';
import { useTheme2 } from '@grafana/ui';
import { SparkleIcon } from '../../../icons';

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
        <SparkleIcon size={44} color={theme.colors.text.primary} className="animate-sparkle" />
        <h1 className="text-5xl font-bold tracking-tight" style={{ color: theme.colors.text.primary }}>
          Ask O11y Assistant
        </h1>
      </div>

      {/* Status badge and version */}
      <div className="flex items-center gap-3 mb-8">
        <span className="status-badge">BETA</span>
        <span className="text-base" style={{ color: theme.colors.text.secondary }}>
          v0.2.3
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
