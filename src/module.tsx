import React, { Suspense, lazy } from 'react';
import { AppPlugin, type AppRootProps } from '@grafana/data';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AppLoader, InlineAppLoader } from './components/AppLoader';
import { PluginRoot } from './PluginRoot';
import type { AppConfigProps } from './components/AppConfig/AppConfig';
import type { AppPluginSettings } from './types/plugin';

const LazyApp = lazy(() => import('./components/App/App'));
const LazyAppConfig = lazy(() => import('./components/AppConfig/AppConfig'));

const App = (props: AppRootProps) => (
  <PluginRoot>
    <ErrorBoundary fallbackTitle="Application Error">
      <Suspense fallback={<AppLoader />}>
        <LazyApp {...props} />
      </Suspense>
    </ErrorBoundary>
  </PluginRoot>
);

const AppConfig = (props: AppConfigProps) => (
  <PluginRoot>
    <ErrorBoundary fallbackTitle="Configuration Error">
      <Suspense fallback={<InlineAppLoader text="Loading configuration..." />}>
        <LazyAppConfig {...props} />
      </Suspense>
    </ErrorBoundary>
  </PluginRoot>
);

export const plugin = new AppPlugin<AppPluginSettings>().setRootPage(App).addConfigPage({
  title: 'Configuration',
  icon: 'cog',
  body: AppConfig,
  id: 'configuration',
});
