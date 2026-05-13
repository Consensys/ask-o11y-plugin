import React, { ReactNode } from 'react';
import { GrafanaThemeProvider } from './theme';
import './index.css';

export const PLUGIN_ROOT_CLASS = 'ask-o11y-plugin-root';

interface PluginRootProps {
  children: ReactNode;
}

export const PluginRoot = ({ children }: PluginRootProps) => (
  <GrafanaThemeProvider className={PLUGIN_ROOT_CLASS} style={{ width: '100%', height: '100%' }}>
    {children}
  </GrafanaThemeProvider>
);
