import React, { useRef, useEffect, ReactNode } from 'react';
import { useTheme2 } from '@grafana/ui';
import { GrafanaTheme2 } from '@grafana/data';

interface GrafanaThemeProviderProps {
  children: ReactNode;
}

const setThemeCustomProperties = (element: HTMLElement, theme: GrafanaTheme2) => {
  // Primary colors
  element.style.setProperty('--grafana-color-primary', theme.colors.primary.main);
  element.style.setProperty('--grafana-color-primary-light', theme.colors.primary.shade);
  element.style.setProperty('--grafana-color-primary-dark', theme.colors.primary.main);
  element.style.setProperty('--grafana-color-primary-transparent', theme.colors.primary.transparent);

  // Secondary colors
  element.style.setProperty('--grafana-color-secondary', theme.colors.secondary.main);
  element.style.setProperty('--grafana-color-secondary-light', theme.colors.secondary.shade);
  element.style.setProperty('--grafana-color-secondary-dark', theme.colors.secondary.main);

  // Background colors
  element.style.setProperty('--grafana-color-background-primary', theme.colors.background.primary);
  element.style.setProperty('--grafana-color-background-secondary', theme.colors.background.secondary);
  element.style.setProperty('--grafana-color-background-canvas', theme.colors.background.canvas);
  element.style.setProperty(
    '--grafana-color-background-elevated',
    theme.colors.emphasize(theme.colors.background.secondary, 0.03)
  );

  // Text colors
  element.style.setProperty('--grafana-color-text-primary', theme.colors.text.primary);
  element.style.setProperty('--grafana-color-text-secondary', theme.colors.text.secondary);
  element.style.setProperty('--grafana-color-text-disabled', theme.colors.text.disabled);
  element.style.setProperty('--grafana-color-text-link', theme.colors.text.link);
  element.style.setProperty('--grafana-color-text-link-hover', theme.colors.emphasize(theme.colors.text.link, 0.15));
  element.style.setProperty(
    '--grafana-color-text-primary-inverse',
    theme.colors.getContrastText(theme.colors.primary.main)
  );

  // Border colors
  element.style.setProperty('--grafana-color-border-weak', theme.colors.border.weak);
  element.style.setProperty('--grafana-color-border-medium', theme.colors.border.medium);
  element.style.setProperty('--grafana-color-border-strong', theme.colors.border.strong);

  // Status colors
  element.style.setProperty('--grafana-color-success', theme.colors.success.main);
  element.style.setProperty('--grafana-color-success-light', theme.colors.success.shade);
  element.style.setProperty('--grafana-color-success-dark', theme.colors.success.main);

  element.style.setProperty('--grafana-color-warning', theme.colors.warning.main);
  element.style.setProperty('--grafana-color-warning-light', theme.colors.warning.shade);
  element.style.setProperty('--grafana-color-warning-dark', theme.colors.warning.main);

  element.style.setProperty('--grafana-color-error', theme.colors.error.main);
  element.style.setProperty('--grafana-color-error-light', theme.colors.error.shade);
  element.style.setProperty('--grafana-color-error-dark', theme.colors.error.main);

  element.style.setProperty('--grafana-color-info', theme.colors.info.main);
  element.style.setProperty('--grafana-color-info-light', theme.colors.info.shade);
  element.style.setProperty('--grafana-color-info-dark', theme.colors.info.main);

  // Spacing
  element.style.setProperty('--grafana-spacing-xs', theme.spacing(0.5));
  element.style.setProperty('--grafana-spacing-sm', theme.spacing(1));
  element.style.setProperty('--grafana-spacing-md', theme.spacing(2));
  element.style.setProperty('--grafana-spacing-lg', theme.spacing(3));
  element.style.setProperty('--grafana-spacing-xl', theme.spacing(4));
  element.style.setProperty('--grafana-spacing-xxl', theme.spacing(6));

  // Border radius
  element.style.setProperty('--grafana-border-radius-sm', theme.shape.radius.default);
  element.style.setProperty('--grafana-border-radius', theme.shape.radius.default);
  element.style.setProperty('--grafana-border-radius-lg', `calc(${theme.shape.radius.default} * 1.5)`);
  element.style.setProperty('--grafana-border-radius-xl', `calc(${theme.shape.radius.default} * 2)`);

  // Typography
  element.style.setProperty('--grafana-font-family', theme.typography.fontFamily);
  element.style.setProperty('--grafana-font-family-mono', theme.typography.fontFamilyMonospace);

  element.style.setProperty('--grafana-font-size-xs', theme.typography.bodySmall.fontSize);
  element.style.setProperty('--grafana-font-size-sm', theme.typography.bodySmall.fontSize);
  element.style.setProperty('--grafana-font-size-base', theme.typography.body.fontSize);
  element.style.setProperty('--grafana-font-size-lg', theme.typography.h6.fontSize);
  element.style.setProperty('--grafana-font-size-xl', theme.typography.h5.fontSize);

  element.style.setProperty('--grafana-line-height-xs', '1.2');
  element.style.setProperty('--grafana-line-height-sm', '1.3');
  element.style.setProperty('--grafana-line-height-base', '1.4');
  element.style.setProperty('--grafana-line-height-lg', '1.5');
  element.style.setProperty('--grafana-line-height-xl', '1.6');

  // Shadows
  element.style.setProperty('--grafana-shadow-sm', theme.shadows.z1);
  element.style.setProperty('--grafana-shadow-md', theme.shadows.z2);
  element.style.setProperty('--grafana-shadow-lg', theme.shadows.z3);
  element.style.setProperty('--grafana-shadow-panel', theme.shadows.z1);

  // Z-index
  element.style.setProperty('--grafana-z-index-dropdown', theme.zIndex.dropdown.toString());
  element.style.setProperty('--grafana-z-index-modal', theme.zIndex.modal.toString());
  element.style.setProperty('--grafana-z-index-tooltip', theme.zIndex.tooltip.toString());
};

export const GrafanaThemeProvider: React.FC<GrafanaThemeProviderProps> = ({ children }) => {
  const theme = useTheme2();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      setThemeCustomProperties(containerRef.current, theme);
    }
  }, [theme]);

  return <div ref={containerRef} style={{ height: '100%' }}>{children}</div>;
};
