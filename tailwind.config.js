/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Use CSS custom properties that will be dynamically set based on Grafana theme
        primary: {
          DEFAULT: 'var(--grafana-color-primary)',
          light: 'var(--grafana-color-primary-light)',
          dark: 'var(--grafana-color-primary-dark)',
        },
        secondary: {
          DEFAULT: 'var(--grafana-color-secondary)',
          light: 'var(--grafana-color-secondary-light)',
          dark: 'var(--grafana-color-secondary-dark)',
        },
        background: {
          DEFAULT: 'var(--grafana-color-background-primary)',
          primary: 'var(--grafana-color-background-primary)',
          secondary: 'var(--grafana-color-background-secondary)',
          canvas: 'var(--grafana-color-background-canvas)',
          elevated: 'var(--grafana-color-background-elevated)',
        },
        surface: {
          DEFAULT: 'var(--grafana-color-background-secondary)',
          primary: 'var(--grafana-color-background-secondary)',
          secondary: 'var(--grafana-color-background-canvas)',
        },
        text: {
          DEFAULT: 'var(--grafana-color-text-primary)',
          primary: 'var(--grafana-color-text-primary)',
          secondary: 'var(--grafana-color-text-secondary)',
          disabled: 'var(--grafana-color-text-disabled)',
          link: 'var(--grafana-color-text-link)',
          'link-hover': 'var(--grafana-color-text-link-hover)',
        },
        border: {
          DEFAULT: 'var(--grafana-color-border-weak)',
          weak: 'var(--grafana-color-border-weak)',
          medium: 'var(--grafana-color-border-medium)',
          strong: 'var(--grafana-color-border-strong)',
        },
        success: {
          DEFAULT: 'var(--grafana-color-success)',
          light: 'var(--grafana-color-success-light)',
          dark: 'var(--grafana-color-success-dark)',
        },
        warning: {
          DEFAULT: 'var(--grafana-color-warning)',
          light: 'var(--grafana-color-warning-light)',
          dark: 'var(--grafana-color-warning-dark)',
        },
        error: {
          DEFAULT: 'var(--grafana-color-error)',
          light: 'var(--grafana-color-error-light)',
          dark: 'var(--grafana-color-error-dark)',
        },
        info: {
          DEFAULT: 'var(--grafana-color-info)',
          light: 'var(--grafana-color-info-light)',
          dark: 'var(--grafana-color-info-dark)',
        },
        // Semantic color mappings for common use cases
        card: {
          DEFAULT: 'var(--grafana-color-background-secondary)',
          border: 'var(--grafana-color-border-weak)',
        },
        input: {
          DEFAULT: 'var(--grafana-color-background-primary)',
          border: 'var(--grafana-color-border-medium)',
          focus: 'var(--grafana-color-primary)',
        },
        // Chat-specific semantic colors
        chat: {
          user: 'var(--grafana-color-primary)',
          'user-text': 'var(--grafana-color-text-primary-inverse)',
          assistant: 'var(--grafana-color-background-secondary)',
          'assistant-text': 'var(--grafana-color-text-primary)',
          container: 'var(--grafana-color-background-canvas)',
        },
        // Muted colors for streamdown code blocks (shadcn/ui style)
        muted: {
          DEFAULT: 'var(--grafana-color-background-secondary)',
          foreground: 'var(--grafana-color-text-secondary)',
        },
      },
      borderRadius: {
        DEFAULT: 'var(--grafana-border-radius)',
        sm: 'var(--grafana-border-radius-sm)',
        md: 'var(--grafana-border-radius)',
        lg: 'var(--grafana-border-radius-lg)',
        xl: 'var(--grafana-border-radius-xl)',
      },
      spacing: {
        // Add Grafana-specific spacing scale
        xs: 'var(--grafana-spacing-xs)',
        sm: 'var(--grafana-spacing-sm)',
        md: 'var(--grafana-spacing-md)',
        lg: 'var(--grafana-spacing-lg)',
        xl: 'var(--grafana-spacing-xl)',
        xxl: 'var(--grafana-spacing-xxl)',
      },
      fontSize: {
        xs: ['var(--grafana-font-size-xs)', { lineHeight: 'var(--grafana-line-height-xs)' }],
        sm: ['var(--grafana-font-size-sm)', { lineHeight: 'var(--grafana-line-height-sm)' }],
        base: ['var(--grafana-font-size-base)', { lineHeight: 'var(--grafana-line-height-base)' }],
        lg: ['var(--grafana-font-size-lg)', { lineHeight: 'var(--grafana-line-height-lg)' }],
        xl: ['var(--grafana-font-size-xl)', { lineHeight: 'var(--grafana-line-height-xl)' }],
      },
      boxShadow: {
        'grafana-sm': 'var(--grafana-shadow-sm)',
        'grafana-md': 'var(--grafana-shadow-md)',
        'grafana-lg': 'var(--grafana-shadow-lg)',
        'grafana-panel': 'var(--grafana-shadow-panel)',
      },
      fontFamily: {
        grafana: 'var(--grafana-font-family)',
        'grafana-mono': 'var(--grafana-font-family-mono)',
      },
    },
  },
  plugins: [
    // Custom plugin to add Grafana-specific utilities
    function ({ addUtilities, theme }) {
      const newUtilities = {
        '.grafana-panel': {
          backgroundColor: 'var(--grafana-color-background-secondary)',
          border: `1px solid var(--grafana-color-border-weak)`,
          borderRadius: 'var(--grafana-border-radius)',
          boxShadow: 'var(--grafana-shadow-panel)',
        },
        '.grafana-card': {
          backgroundColor: 'var(--grafana-color-background-secondary)',
          border: `1px solid var(--grafana-color-border-weak)`,
          borderRadius: 'var(--grafana-border-radius)',
          boxShadow: 'var(--grafana-shadow-sm)',
        },
        '.grafana-input': {
          backgroundColor: 'var(--grafana-color-background-primary)',
          border: `1px solid var(--grafana-color-border-medium)`,
          borderRadius: 'var(--grafana-border-radius-sm)',
          color: 'var(--grafana-color-text-primary)',
          '&:focus': {
            borderColor: 'var(--grafana-color-primary)',
            outline: 'none',
            boxShadow: `0 0 0 2px var(--grafana-color-primary-transparent)`,
          },
        },
        '.grafana-button-primary': {
          backgroundColor: 'var(--grafana-color-primary)',
          color: 'var(--grafana-color-text-primary-inverse)',
          border: '1px solid var(--grafana-color-primary)',
          borderRadius: 'var(--grafana-border-radius-sm)',
          '&:hover': {
            backgroundColor: 'var(--grafana-color-primary-dark)',
          },
        },
        '.grafana-button-secondary': {
          backgroundColor: 'var(--grafana-color-background-secondary)',
          color: 'var(--grafana-color-text-primary)',
          border: '1px solid var(--grafana-color-border-medium)',
          borderRadius: 'var(--grafana-border-radius-sm)',
          '&:hover': {
            backgroundColor: 'var(--grafana-color-background-canvas)',
          },
        },
      };
      addUtilities(newUtilities);
    },
  ],
};
