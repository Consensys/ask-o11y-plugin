import React, { useEffect, useState } from 'react';
import { Route, Routes } from 'react-router-dom';
import { AppRootProps } from '@grafana/data';
import { GrafanaThemeProvider } from '../../theme';
import { AppLoader } from '../AppLoader';
import Home from '../../pages/Home';
import SharedSession from '../../pages/SharedSession';
import type { AppPluginSettings } from '../../types/plugin';

function App(props: AppRootProps<AppPluginSettings>) {
  const pluginSettings = props.meta.jsonData || {};
  const [i18nReady, setI18nReady] = useState(false);

  useEffect(() => {
    const initI18n = async () => {
      try {
        const { initPluginTranslations } = await import('@grafana/i18n');
        await initPluginTranslations('consensys-asko11y-app');
      } catch {
        // Older Grafana versions don't have @grafana/i18n
      } finally {
        setI18nReady(true);
      }
    };
    initI18n();
  }, []);

  if (!i18nReady) {
    return <AppLoader />;
  }

  return (
    <GrafanaThemeProvider>
      <Routes>
        <Route path="/shared/:shareId" element={<SharedSession />} />
        <Route path="*" element={<Home pluginSettings={pluginSettings} />} />
      </Routes>
    </GrafanaThemeProvider>
  );
}

export default App;
