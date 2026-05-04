import React, { Suspense, lazy } from 'react';
import { AppPlugin, type AppRootProps } from '@grafana/data';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AppLoader, InlineAppLoader } from './components/AppLoader';
import type { AppConfigProps } from './components/AppConfig/AppConfig';
import type { AppPluginSettings } from './types/plugin';

// Import Tailwind CSS
import './index.css';

const LazyApp = lazy(() => import('./components/App/App'));
const LazyAppConfig = lazy(() => import('./components/AppConfig/AppConfig'));

const App = (props: AppRootProps) => (
  <ErrorBoundary fallbackTitle="Application Error">
    <Suspense fallback={<AppLoader />}>
      <LazyApp {...props} />
    </Suspense>
  </ErrorBoundary>
);

const AppConfig = (props: AppConfigProps) => (
  <ErrorBoundary fallbackTitle="Configuration Error">
    <Suspense fallback={<InlineAppLoader text="Loading configuration..." />}>
      <LazyAppConfig {...props} />
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
  });
