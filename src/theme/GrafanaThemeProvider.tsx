import React, { useEffect, ReactNode } from 'react';
import { useTheme2 } from '@grafana/ui';
import { GrafanaTheme2 } from '@grafana/data';

interface GrafanaThemeProviderProps {
  children: ReactNode;
}

const setThemeCustomProperties = (theme: GrafanaTheme2) => {
  const root = document.documentElement;

  // Primary colors
  root.style.setProperty('--grafana-color-primary', theme.colors.primary.main);
  root.style.setProperty('--grafana-color-primary-light', theme.colors.primary.shade);
  root.style.setProperty('--grafana-color-primary-dark', theme.colors.primary.main);
  root.style.setProperty('--grafana-color-primary-transparent', theme.colors.primary.transparent);

  // Secondary colors
  root.style.setProperty('--grafana-color-secondary', theme.colors.secondary.main);
  root.style.setProperty('--grafana-color-secondary-light', theme.colors.secondary.shade);
  root.style.setProperty('--grafana-color-secondary-dark', theme.colors.secondary.main);

  // Background colors
  root.style.setProperty('--grafana-color-background-primary', theme.colors.background.primary);
  root.style.setProperty('--grafana-color-background-secondary', theme.colors.background.secondary);
  root.style.setProperty('--grafana-color-background-canvas', theme.colors.background.canvas);
  root.style.setProperty(
    '--grafana-color-background-elevated',
    theme.colors.emphasize(theme.colors.background.secondary, 0.03)
  );

  // Text colors
  root.style.setProperty('--grafana-color-text-primary', theme.colors.text.primary);
  root.style.setProperty('--grafana-color-text-secondary', theme.colors.text.secondary);
  root.style.setProperty('--grafana-color-text-disabled', theme.colors.text.disabled);
  root.style.setProperty('--grafana-color-text-link', theme.colors.text.link);
  root.style.setProperty('--grafana-color-text-link-hover', theme.colors.emphasize(theme.colors.text.link, 0.15));
  root.style.setProperty(
    '--grafana-color-text-primary-inverse',
    theme.colors.getContrastText(theme.colors.primary.main)
  );

  // Border colors
  root.style.setProperty('--grafana-color-border-weak', theme.colors.border.weak);
  root.style.setProperty('--grafana-color-border-medium', theme.colors.border.medium);
  root.style.setProperty('--grafana-color-border-strong', theme.colors.border.strong);

  // Status colors
  root.style.setProperty('--grafana-color-success', theme.colors.success.main);
  root.style.setProperty('--grafana-color-success-light', theme.colors.success.shade);
  root.style.setProperty('--grafana-color-success-dark', theme.colors.success.main);

  root.style.setProperty('--grafana-color-warning', theme.colors.warning.main);
  root.style.setProperty('--grafana-color-warning-light', theme.colors.warning.shade);
  root.style.setProperty('--grafana-color-warning-dark', theme.colors.warning.main);

  root.style.setProperty('--grafana-color-error', theme.colors.error.main);
  root.style.setProperty('--grafana-color-error-light', theme.colors.error.shade);
  root.style.setProperty('--grafana-color-error-dark', theme.colors.error.main);

  root.style.setProperty('--grafana-color-info', theme.colors.info.main);
  root.style.setProperty('--grafana-color-info-light', theme.colors.info.shade);
  root.style.setProperty('--grafana-color-info-dark', theme.colors.info.main);

  // Spacing
  root.style.setProperty('--grafana-spacing-xs', theme.spacing(0.5));
  root.style.setProperty('--grafana-spacing-sm', theme.spacing(1));
  root.style.setProperty('--grafana-spacing-md', theme.spacing(2));
  root.style.setProperty('--grafana-spacing-lg', theme.spacing(3));
  root.style.setProperty('--grafana-spacing-xl', theme.spacing(4));
  root.style.setProperty('--grafana-spacing-xxl', theme.spacing(6));

  // Border radius
  root.style.setProperty('--grafana-border-radius-sm', theme.shape.radius.default);
  root.style.setProperty('--grafana-border-radius', theme.shape.radius.default);
  root.style.setProperty('--grafana-border-radius-lg', `calc(${theme.shape.radius.default} * 1.5)`);
  root.style.setProperty('--grafana-border-radius-xl', `calc(${theme.shape.radius.default} * 2)`);

  // Typography
  root.style.setProperty('--grafana-font-family', theme.typography.fontFamily);
  root.style.setProperty('--grafana-font-family-mono', theme.typography.fontFamilyMonospace);

  root.style.setProperty('--grafana-font-size-xs', theme.typography.bodySmall.fontSize);
  root.style.setProperty('--grafana-font-size-sm', theme.typography.bodySmall.fontSize);
  root.style.setProperty('--grafana-font-size-base', theme.typography.body.fontSize);
  root.style.setProperty('--grafana-font-size-lg', theme.typography.h6.fontSize);
  root.style.setProperty('--grafana-font-size-xl', theme.typography.h5.fontSize);

  root.style.setProperty('--grafana-line-height-xs', '1.2');
  root.style.setProperty('--grafana-line-height-sm', '1.3');
  root.style.setProperty('--grafana-line-height-base', '1.4');
  root.style.setProperty('--grafana-line-height-lg', '1.5');
  root.style.setProperty('--grafana-line-height-xl', '1.6');

  // Shadows
  root.style.setProperty('--grafana-shadow-sm', theme.shadows.z1);
  root.style.setProperty('--grafana-shadow-md', theme.shadows.z2);
  root.style.setProperty('--grafana-shadow-lg', theme.shadows.z3);
  root.style.setProperty('--grafana-shadow-panel', theme.shadows.z1);

  // Z-index
  root.style.setProperty('--grafana-z-index-dropdown', theme.zIndex.dropdown.toString());
  root.style.setProperty('--grafana-z-index-modal', theme.zIndex.modal.toString());
  root.style.setProperty('--grafana-z-index-tooltip', theme.zIndex.tooltip.toString());
};

export const GrafanaThemeProvider: React.FC<GrafanaThemeProviderProps> = ({ children }) => {
  const theme = useTheme2();

  useEffect(() => {
    // Set CSS custom properties when theme changes
    setThemeCustomProperties(theme);
  }, [theme]);

  return <>{children}</>;
};
