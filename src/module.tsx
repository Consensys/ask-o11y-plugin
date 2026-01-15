import React, { Suspense, lazy } from 'react';
import { AppPlugin, type AppRootProps } from '@grafana/data';
import { LoadingPlaceholder } from '@grafana/ui';
import { ErrorBoundary } from './components/ErrorBoundary';
import type { AppConfigProps } from './components/AppConfig/AppConfig';
import type { AppPluginSettings } from './types/plugin';

// Import Tailwind CSS
import './index.css';

const LazyApp = lazy(() => import('./components/App/App'));
const LazyAppConfig = lazy(() => import('./components/AppConfig/AppConfig'));
const LazyMCPStatus = lazy(() => import('./components/MCPStatus').then((module) => ({ default: module.MCPStatus })));

const App = (props: AppRootProps) => (
  <ErrorBoundary fallbackTitle="Application Error">
    <Suspense fallback={<LoadingPlaceholder text="" />}>
      <LazyApp {...props} />
    </Suspense>
  </ErrorBoundary>
);

const AppConfig = (props: AppConfigProps) => (
  <ErrorBoundary fallbackTitle="Configuration Error">
    <Suspense fallback={<LoadingPlaceholder text="" />}>
      <LazyAppConfig {...props} />
    </Suspense>
  </ErrorBoundary>
);

const MCPStatus = (props: any) => (
  <ErrorBoundary fallbackTitle="MCP Status Error">
    <Suspense fallback={<LoadingPlaceholder text="" />}>
      <LazyMCPStatus onClose={() => {}} />
    </Suspense>
  </ErrorBoundary>
);

export const plugin = new AppPlugin<AppPluginSettings>()
  .setRootPage(App)
  .addConfigPage({
    title: 'Configuration',
    icon: 'cog',
    body: AppConfig,
    id: 'configuration',
  })
  .addConfigPage({
    title: 'MCP Connections',
    icon: 'plug',
    body: MCPStatus,
    id: 'mcp-connections',
  });
