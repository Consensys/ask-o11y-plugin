import React, { useEffect, useState } from 'react';
import { Route, Routes } from 'react-router-dom';
import { AppRootProps } from '@grafana/data';
import { GrafanaThemeProvider } from '../../theme';
import type { AppPluginSettings } from '../../types/plugin';
const Home = React.lazy(() => import('../../pages/Home'));
const SharedSession = React.lazy(() => import('../../pages/SharedSession'));
// const MCPTools = React.lazy(() => import('../../pages/MCPTools'));

function App(props: AppRootProps<AppPluginSettings>) {
  const pluginSettings = props.meta.jsonData || {};
  const [i18nReady, setI18nReady] = useState(false);

  useEffect(() => {
    // Initialize i18n for the plugin
    const initI18n = async () => {
      try {
        // Import i18n initialization from @grafana/i18n if available
        const { initPluginTranslations } = await import('@grafana/i18n');
        await initPluginTranslations('consensys-asko11y-app');
        console.log('[App] i18n initialized successfully');
      } catch (error) {
        console.warn('[App] Could not initialize i18n (older Grafana version?):', error);
        // Continue anyway - older Grafana versions don't have @grafana/i18n
      } finally {
        setI18nReady(true);
      }
    };

    initI18n();
  }, []);

  // Wait for i18n to be ready before rendering
  if (!i18nReady) {
    return null;
  }

  return (
    <GrafanaThemeProvider>
      <Routes>
        {/* MCP Tools management page */}
        {/* <Route path="/tools" element={<MCPTools />} /> */}
        {/* Shared session page */}
        <Route path="/shared/:shareId" element={<SharedSession />} />
        {/* Default page */}
        <Route path="*" element={<Home pluginSettings={pluginSettings} />} />
      </Routes>
    </GrafanaThemeProvider>
  );
}

export default App;
