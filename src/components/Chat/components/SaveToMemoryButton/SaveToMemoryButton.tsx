import React, { useState, useCallback } from 'react';
import { useStyles2, useTheme2 } from '@grafana/ui';
import { cx } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { getHoverButtonStyle } from '../../../../theme';
import { ingestSession } from '../../../../services/backendSessionClient';
import type { ChatMessage } from '../../types';

type Status = 'idle' | 'loading' | 'success' | 'error';

interface SaveToMemoryButtonProps {
  messages: ChatMessage[];
}

export function SaveToMemoryButton({ messages }: SaveToMemoryButtonProps): React.ReactElement {
  const theme = useTheme2();
  const styles = useStyles2(getStyles);
  const [status, setStatus] = useState<Status>('idle');
  const [errorText, setErrorText] = useState('');

  const handleClick = useCallback(async () => {
    setStatus('loading');
    try {
      await ingestSession(messages);
      setStatus('success');
      setTimeout(() => setStatus('idle'), 2000);
    } catch (err) {
      setErrorText(err instanceof Error ? err.message : 'Failed to save');
      setStatus('error');
      setTimeout(() => setStatus('idle'), 3000);
    }
  }, [messages]);

  const label =
    status === 'loading'
      ? 'Saving…'
      : status === 'success'
        ? 'Saved!'
        : status === 'error'
          ? errorText
          : 'Save to memory';

  const iconColor =
    status === 'success'
      ? theme.colors.success.text
      : status === 'error'
        ? theme.colors.error.text
        : theme.colors.text.secondary;

  return (
    <button
      onClick={handleClick}
      disabled={status === 'loading'}
      className={cx(
        'flex items-center gap-2 px-2 py-1 text-xs font-medium rounded-md transition-colors',
        styles.hoverButton
      )}
      aria-label="Save session to memory"
      title="Save this session to the knowledge graph"
      style={{ color: iconColor }}
    >
      {status === 'loading' && <SpinnerIcon />}
      {status === 'success' && <CheckIcon />}
      {status === 'error' && <XIcon />}
      {status === 'idle' && <BrainIcon />}
      <span>{label}</span>
    </button>
  );
}

function BrainIcon(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.46 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2Z" />
      <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.46 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 14.5 2Z" />
    </svg>
  );
}

function SpinnerIcon(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ animation: 'spin 1s linear infinite' }}>
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

function CheckIcon(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function XIcon(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  hoverButton: getHoverButtonStyle(theme),
});
