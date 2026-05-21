import React from 'react';
import { useTheme2 } from '@grafana/ui';

interface ChatHeaderProps {
  isGenerating: boolean;
  currentSessionTitle?: string;
  currentModelLabel?: string;
}

export const ChatHeader: React.FC<ChatHeaderProps> = ({ isGenerating, currentSessionTitle, currentModelLabel }) => {
  const theme = useTheme2();

  return (
    <div className="flex justify-between items-center py-3 mb-2">
      <div className="flex items-center gap-3">
        {/* Session title */}
        {currentSessionTitle && (
          <span
            className="text-sm truncate max-w-md font-medium"
            style={{ color: theme.colors.text.secondary }}
            title={currentSessionTitle}
          >
            {currentSessionTitle}
          </span>
        )}
        {currentModelLabel && (
          <span
            className="text-xs px-2 py-0.5 rounded border border-weak bg-secondary"
            style={{ color: theme.colors.text.secondary }}
            title={currentModelLabel}
          >
            {currentModelLabel}
          </span>
        )}
      </div>
    </div>
  );
};
