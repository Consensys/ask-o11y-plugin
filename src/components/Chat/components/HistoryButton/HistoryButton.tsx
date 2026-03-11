import React from 'react';
import { useStyles2, useTheme2 } from '@grafana/ui';
import { cx } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { getHoverButtonStyle } from '../../../../theme';

interface HistoryButtonProps {
  onClick: () => void;
  sessionCount: number;
}

export function HistoryButton({ onClick, sessionCount }: HistoryButtonProps): React.ReactElement {
  const theme = useTheme2();
  const styles = useStyles2(getStyles);

  return (
    <button
      onClick={onClick}
      className={cx('flex items-center gap-2 px-2 py-1 text-xs font-medium rounded-md transition-colors', styles.hoverButton)}
      aria-label="Chat history"
      title="View chat history"
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
      >
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
      <span>View chat history ({sessionCount})</span>
    </button>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  hoverButton: getHoverButtonStyle(theme),
});
