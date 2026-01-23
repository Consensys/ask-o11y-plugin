import React from 'react';
import { Spinner, useTheme2 } from '@grafana/ui';

interface AppLoaderProps {
  text?: string;
}

const SparkleIcon: React.FC<{ size?: number; color: string }> = ({ size = 32, color }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M12 2L13.09 8.26L18 6L14.74 10.91L21 12L14.74 13.09L18 18L13.09 15.74L12 22L10.91 15.74L6 18L9.26 13.09L3 12L9.26 10.91L6 6L10.91 8.26L12 2Z"
      fill={color}
      opacity={0.6}
    />
  </svg>
);

export const AppLoader: React.FC<AppLoaderProps> = ({ text = 'Loading Ask O11y...' }) => {
  const theme = useTheme2();

  return (
    <div className="flex flex-col items-center justify-center min-h-[300px] animate-fadeIn">
      <div className="flex items-center gap-3 mb-4">
        <SparkleIcon color={theme.colors.primary.main} />
        <Spinner size="xl" />
        <SparkleIcon color={theme.colors.primary.main} />
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
