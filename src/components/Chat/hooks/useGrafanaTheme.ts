import { useEffect } from 'react';
import { useTheme2 } from '@grafana/ui';

/**
 * Hook to sync Grafana theme to CSS custom properties
 * This ensures that the chat interface and embedded Scenes use the correct theme
 */
export const useGrafanaTheme = () => {
  const theme = useTheme2();

  useEffect(() => {
    if (!theme) {
      return;
    }

    // Get the root element
    const root = document.documentElement;

    // Sync Grafana theme colors to CSS custom properties
    root.style.setProperty('--grafana-color-primary', theme.colors.primary.main);
    root.style.setProperty('--grafana-color-primary-light', theme.colors.primary.shade);
    root.style.setProperty('--grafana-color-primary-dark', theme.colors.primary.shade);
    root.style.setProperty('--grafana-color-primary-transparent', theme.colors.primary.transparent);

    root.style.setProperty('--grafana-color-secondary', theme.colors.secondary.main);
    root.style.setProperty('--grafana-color-secondary-light', theme.colors.secondary.shade);
    root.style.setProperty('--grafana-color-secondary-dark', theme.colors.secondary.shade);

    root.style.setProperty('--grafana-color-background-primary', theme.colors.background.primary);
    root.style.setProperty('--grafana-color-background-secondary', theme.colors.background.secondary);
    root.style.setProperty('--grafana-color-background-canvas', theme.colors.background.canvas);
    root.style.setProperty('--grafana-color-background-elevated', theme.colors.background.primary);

    root.style.setProperty('--grafana-color-text-primary', theme.colors.text.primary);
    root.style.setProperty('--grafana-color-text-secondary', theme.colors.text.secondary);
    root.style.setProperty('--grafana-color-text-disabled', theme.colors.text.disabled);
    root.style.setProperty('--grafana-color-text-link', theme.colors.text.link);
    root.style.setProperty('--grafana-color-text-link-hover', theme.colors.text.link);
    root.style.setProperty('--grafana-color-text-primary-inverse', theme.colors.text.primary);

    root.style.setProperty('--grafana-color-border-weak', theme.colors.border.weak);
    root.style.setProperty('--grafana-color-border-medium', theme.colors.border.medium);
    root.style.setProperty('--grafana-color-border-strong', theme.colors.border.strong);

    root.style.setProperty('--grafana-color-success', theme.colors.success.main);
    root.style.setProperty('--grafana-color-success-light', theme.colors.success.shade);
    root.style.setProperty('--grafana-color-success-dark', theme.colors.success.shade);

    root.style.setProperty('--grafana-color-warning', theme.colors.warning.main);
    root.style.setProperty('--grafana-color-warning-light', theme.colors.warning.shade);
    root.style.setProperty('--grafana-color-warning-dark', theme.colors.warning.shade);

    root.style.setProperty('--grafana-color-error', theme.colors.error.main);
    root.style.setProperty('--grafana-color-error-light', theme.colors.error.shade);
    root.style.setProperty('--grafana-color-error-dark', theme.colors.error.shade);

    root.style.setProperty('--grafana-color-info', theme.colors.info.main);
    root.style.setProperty('--grafana-color-info-light', theme.colors.info.shade);
    root.style.setProperty('--grafana-color-info-dark', theme.colors.info.shade);

    // Set spacing
    root.style.setProperty('--grafana-spacing-xs', `${theme.spacing(0.5)}px`);
    root.style.setProperty('--grafana-spacing-sm', `${theme.spacing(1)}px`);
    root.style.setProperty('--grafana-spacing-md', `${theme.spacing(2)}px`);
    root.style.setProperty('--grafana-spacing-lg', `${theme.spacing(3)}px`);
    root.style.setProperty('--grafana-spacing-xl', `${theme.spacing(4)}px`);
    root.style.setProperty('--grafana-spacing-xxl', `${theme.spacing(6)}px`);

    // Set border radius
    root.style.setProperty('--grafana-border-radius-sm', theme.shape.radius.default);
    root.style.setProperty('--grafana-border-radius', theme.shape.radius.default);
    root.style.setProperty('--grafana-border-radius-lg', theme.shape.radius.default);
    root.style.setProperty('--grafana-border-radius-xl', theme.shape.radius.default);

    // Set typography
    root.style.setProperty('--grafana-font-family', theme.typography.fontFamily);
    root.style.setProperty('--grafana-font-family-mono', theme.typography.fontFamilyMonospace);

    console.log('[Theme] Grafana theme synced to CSS custom properties', {
      isDark: theme.isDark,
      name: theme.name,
    });
  }, [theme]);

  return theme;
};
