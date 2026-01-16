import React from 'react';
import '../src/index.css';
import { themes } from '@storybook/theming';

export const parameters = {
  actions: { argTypesRegex: '^on[A-Z].*' },
  controls: {
    matchers: {
      color: /(background|color)$/i,
      date: /Date$/,
    },
  },
  docs: {
    theme: themes.dark,
  },
  backgrounds: {
    default: 'dark',
    values: [
      {
        name: 'dark',
        value: '#111111',
      },
      {
        name: 'light',
        value: '#ffffff',
      },
    ],
  },
};

// Mock Grafana theme
export const decorators = [
  (Story) => {
    // Add Grafana theme CSS variables to Storybook
    document.documentElement.style.setProperty('--theme-primary', '#3274D9');
    document.documentElement.style.setProperty('--theme-error', '#E02F44');
    document.documentElement.style.setProperty('--theme-warning', '#FF851B');
    document.documentElement.style.setProperty('--theme-success', '#299C46');
    document.documentElement.style.setProperty('--theme-info', '#8AB8FF');
    document.documentElement.style.setProperty('--theme-text-primary', '#CCCCDC');
    document.documentElement.style.setProperty('--theme-text-secondary', '#9FA4B1');
    document.documentElement.style.setProperty('--theme-bg-primary', '#111111');
    document.documentElement.style.setProperty('--theme-bg-secondary', '#181B1F');
    document.documentElement.style.setProperty('--theme-border-weak', '#22252B');
    document.documentElement.style.setProperty('--theme-border-medium', '#2C3135');

    return <Story />;
  },
];
