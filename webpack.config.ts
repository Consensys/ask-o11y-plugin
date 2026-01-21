import type { Configuration, RuleSetRule } from 'webpack';
import { merge } from 'webpack-merge';
import grafanaConfig, { Env } from './.config/webpack/webpack.config';
import path from 'path';

const config = async (env: Env): Promise<Configuration> => {
  const baseConfig = await grafanaConfig(env);
  const isCoverage = env.coverage === true || process.env.COVERAGE === 'true';
  const isProduction = env.production === true;

  // Filter out the base CSS rule and replace it with our own that includes postcss-loader
  // This ensures Tailwind CSS is properly processed in both dev and prod
  const baseRules = (baseConfig.module?.rules || [])
    .filter((rule): rule is RuleSetRule => {
      // Filter out falsy values and non-object rules (webpack allows false, "", 0 to disable rules)
      if (!rule || typeof rule !== 'object') {
        return false;
      }
      // Filter out CSS rules - we'll add our own with postcss-loader
      if ('test' in rule) {
        const test = rule.test;
        // Match both /\.css$/ regex and string patterns
        if (test instanceof RegExp) {
          const testStr = test.toString();
          if (testStr === '/\\.css$/' || testStr === '/\\.css$/i') {
            return false;
          }
        }
        if (typeof test === 'string' && (test === '\\.css$' || test === '.css')) {
          return false;
        }
      }
      return true;
    });

  // Build the rules array with our CSS rule that includes postcss-loader
  // Only apply postcss-loader to CSS files in our src directory (for Tailwind)
  // Other CSS files (like from node_modules) should use the base rule without postcss-loader
  const rules: RuleSetRule[] = [
    // CSS rule for our source files (with postcss-loader for Tailwind)
    {
      test: /\.css$/,
      include: path.resolve(process.cwd(), 'src'),
      use: ['style-loader', 'css-loader', 'postcss-loader'],
    },
    // CSS rule for other files (node_modules, etc.) - without postcss-loader
    {
      test: /\.css$/,
      exclude: path.resolve(process.cwd(), 'src'),
      use: ['style-loader', 'css-loader'],
    },
    // Add all other base rules, but modify swc-loader for coverage builds
    ...baseRules.map((rule) => {
      // For coverage builds, disable source maps in swc-loader to avoid conflicts with babel-loader
      if (isCoverage && rule.test && rule.use && typeof rule.use === 'object' && 'loader' in rule.use) {
        const loader = rule.use as { loader: string; options?: any };
        if (loader.loader === 'swc-loader' && loader.options) {
          return {
            ...rule,
            use: {
              ...loader,
              options: {
                ...loader.options,
                sourceMaps: false,
              },
            },
          };
        }
      }
      return rule;
    }),
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
          // Ignore source maps from previous loader to avoid conflicts with swc-loader
          // This prevents babel-loader from trying to process incompatible source maps
          inputSourceMap: undefined,
          sourceMaps: false,
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

  // Merge configs, ensuring module.rules is completely replaced (not concatenated)
  const mergedConfig = merge(baseConfig, {
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

  // Ensure rules array is completely replaced (webpack-merge concatenates arrays by default)
  if (mergedConfig.module) {
    mergedConfig.module.rules = rules;
  }

  return mergedConfig;
};

export default config;
