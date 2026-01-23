import React from 'react';
import { Spinner, useTheme2 } from '@grafana/ui';
import { SparkleIcon } from '../icons';

interface AppLoaderProps {
  text?: string;
}

export const AppLoader: React.FC<AppLoaderProps> = ({ text = 'Loading Ask O11y...' }) => {
  const theme = useTheme2();

  return (
    <div className="flex flex-col items-center justify-center min-h-[300px] animate-fadeIn">
      <div className="flex items-center gap-3 mb-4">
        <SparkleIcon size={32} color={theme.colors.primary.main} opacity={0.6} />
        <Spinner size="xl" />
        <SparkleIcon size={32} color={theme.colors.primary.main} opacity={0.6} />
      </div>
      <p className="text-base" style={{ color: theme.colors.text.secondary }}>
        {text}
      </p>
    </div>
  );
};

export const InlineAppLoader: React.FC<AppLoaderProps> = ({ text = 'Loading Ask O11y...' }) => {
  const theme = useTheme2();

  return (
    <div className="flex items-center gap-2 py-4">
      <Spinner size="md" />
      <span style={{ color: theme.colors.text.secondary }}>{text}</span>
    </div>
  );
};
