import type { Configuration, RuleSetRule } from 'webpack';
import { mergeWithRules } from 'webpack-merge';
import grafanaConfig, { Env } from './.config/webpack/webpack.config';
import path from 'path';

const config = async (env: Env): Promise<Configuration> => {
  const baseConfig = await grafanaConfig(env);
  const isCoverage = env.coverage === true || process.env.COVERAGE === 'true';
  const isProduction = env.production === true;

  // Build the rules array
  const rules: RuleSetRule[] = [
    {
      test: /\.css$/,
      use: ['style-loader', 'css-loader', 'postcss-loader'],
    },
  ];

  // Add Istanbul instrumentation for coverage builds
  if (isCoverage) {
    console.log('📊 Building with Istanbul coverage instrumentation...');
    rules.push({
      test: /\.[tj]sx?$/,
      include: path.resolve(process.cwd(), 'src'),
      exclude: [/node_modules/, /\.test\.[tj]sx?$/, /\.spec\.[tj]sx?$/, /__tests__/, /__mocks__/],
      enforce: 'post',
      use: {
        loader: 'babel-loader',
        options: {
          plugins: [
            [
              'istanbul',
              {
                exclude: [
                  '**/*.test.ts',
                  '**/*.test.tsx',
                  '**/*.spec.ts',
                  '**/*.spec.tsx',
                  '**/__tests__/**',
                  '**/__mocks__/**',
                ],
              },
            ],
          ],
          presets: [
            ['@babel/preset-env', { targets: { node: 'current' } }],
            '@babel/preset-typescript',
            ['@babel/preset-react', { runtime: 'automatic' }],
          ],
        },
      },
    });
  }

  return mergeWithRules({
    module: {
      rules: {
        test: 'match',
        use: 'replace',
      },
    },
  })(baseConfig, {
    module: {
      rules,
    },
    // Always generate source maps for Grafana plugin validator
    devtool: isCoverage ? 'inline-source-map' : 'source-map',
    // Use contenthash in chunk filenames for better CDN cache busting (e.g., Cloudflare)
    // Note: module.js cannot be renamed as Grafana requires that exact filename
    ...(isProduction && {
      output: {
        // Include contenthash in chunk filenames for cache busting
        chunkFilename: '[name].[contenthash:8].js',
      },
    }),
    // Disable optimization for coverage builds to get accurate line numbers
    ...(isCoverage && {
      optimization: {
        minimize: false,
      },
    }),
  });
};

export default config;
