module.exports = {
  stories: ['../src/**/*.stories.@(js|jsx|ts|tsx|mdx)'],
  addons: [
    '@storybook/addon-essentials',
    '@storybook/addon-interactions',
    '@storybook/addon-links',
    '@storybook/addon-a11y',
  ],
  framework: {
    name: '@storybook/react-webpack5',
    options: {},
  },
  features: {
    buildStoriesJson: true,
  },
  typescript: {
    check: false,
    reactDocgen: 'react-docgen-typescript',
    reactDocgenTypescriptOptions: {
      shouldExtractLiteralValuesFromEnum: true,
      propFilter: (prop) => (prop.parent ? !/node_modules/.test(prop.parent.fileName) : true),
    },
  },
  webpackFinal: async (config) => {
    const cssModuleLoader = {
      loader: 'css-loader',
      options: {
        importLoaders: 1,
        modules: {
          mode: 'global',
          exportGlobals: true,
          localIdentName: '[path][name]__[local]',
        },
      },
    };

    config.module.rules.push({
      test: /\.module\.css$/,
      use: ['style-loader', cssModuleLoader, 'postcss-loader'],
    });

    config.module.rules.push({
      test: /\.css$/,
      exclude: /\.module\.css$/,
      use: ['style-loader', 'css-loader', 'postcss-loader'],
    });

    // Add support for absolute imports
    config.resolve.alias = {
      ...config.resolve.alias,
      '@': require('path').resolve(__dirname, '../src'),
    };

    return config;
  },
};
