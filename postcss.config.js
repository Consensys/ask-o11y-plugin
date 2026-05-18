const tailwindcss = require('@tailwindcss/postcss');

const pluginRootSelector = '.ask-o11y-plugin-root';
const ignoredAtRules = new Set(['keyframes', '-webkit-keyframes', 'property']);

const isInsideIgnoredAtRule = (rule) => {
  let parent = rule.parent;
  while (parent) {
    if (parent.type === 'atrule' && ignoredAtRules.has(parent.name)) {
      return true;
    }
    parent = parent.parent;
  }
  return false;
};

const scopeSelector = (selector) => {
  const trimmed = selector.trim();

  if (
    trimmed === '' ||
    trimmed.startsWith(pluginRootSelector) ||
    trimmed.startsWith(':local') ||
    trimmed.startsWith(':global') ||
    trimmed.includes('&')
  ) {
    return selector;
  }

  if (trimmed === ':root' || trimmed === ':host' || trimmed === 'html' || trimmed === 'body') {
    return pluginRootSelector;
  }

  return `${pluginRootSelector} ${selector}`;
};

const scopePluginCss = {
  postcssPlugin: 'scope-ask-o11y-plugin-css',
  Rule(rule) {
    if (isInsideIgnoredAtRule(rule)) {
      return;
    }

    rule.selectors = rule.selectors.map(scopeSelector);
  },
};

module.exports = {
  plugins: [tailwindcss(), scopePluginCss],
};
