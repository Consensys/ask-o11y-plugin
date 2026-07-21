import React, { ReactNode } from 'react';
import { cx } from '@emotion/css';
import { GrafanaThemeProvider } from './theme';
import styles from './PluginRoot.module.css';

export const PLUGIN_ROOT_CLASS = 'ask-o11y-plugin-root';

interface PluginRootProps {
  children: ReactNode;
}

export const PluginRoot = ({ children }: PluginRootProps) => (
  <GrafanaThemeProvider className={cx(PLUGIN_ROOT_CLASS, styles.root)}>
    {children}
  </GrafanaThemeProvider>
);
