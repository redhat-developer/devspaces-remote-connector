//@ts-check
'use strict';

const path = require('path');
const webpack = require('webpack');
const TerserPlugin = require('terser-webpack-plugin');

/** @param {Record<string, string | undefined>} env */
/** @param {{ mode?: string }} argv */
module.exports = (_env, argv) => {
  const isProduction = argv.mode === 'production';

  /** @type {import('webpack').Configuration} */
  const config = {
    target: 'node',
    mode: isProduction ? 'production' : 'none',
    entry: './src/extension.ts',
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: 'extension.js',
      libraryTarget: 'commonjs2',
    },
    externals: {
      vscode: 'commonjs vscode',
      // Optional peer deps of ws that are not needed
      'bufferutil': 'commonjs bufferutil',
      'utf-8-validate': 'commonjs utf-8-validate',
    },
    resolve: {
      extensions: ['.ts', '.js'],
      mainFields: ['module', 'main'],
    },
    optimization: isProduction ? {
      usedExports: true,
      minimize: true,
      minimizer: [
        new TerserPlugin({
          terserOptions: {
            compress: {
              dead_code: true,
              drop_console: false,
              passes: 3,
              unused: true,
              collapse_vars: true,
              reduce_vars: true,
            },
            mangle: true,
            output: {
              comments: false,
            },
          },
          extractComments: false,
        }),
      ],
      concatenateModules: true,
    } : undefined,
    module: {
      rules: [
        {
          test: /\.ts$/,
          exclude: /node_modules/,
          use: [{ loader: 'ts-loader' }],
        },
      ],
    },
    plugins: [
      // Inject build commit hash at compile time
      new webpack.DefinePlugin({
        BUILD_COMMIT: JSON.stringify(
          process.env.CI_COMMIT_SHORT_SHA ||
          (() => {
            try {
              return require('child_process')
                .execSync('git rev-parse --short HEAD', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] })
                .trim();
            } catch {
              return 'dev';
            }
          })()
        ),
      }),
      // Shim `navigator` before any module code runs.
      new webpack.BannerPlugin({
        banner: `try{Object.defineProperty(globalThis,"navigator",{value:{userAgent:"node"},writable:true,configurable:true});}catch(e){}`,
        raw: true,
      }),
      // Ignore optional dependencies that bloat the bundle
      new webpack.IgnorePlugin({ resourceRegExp: /^encoding$/ }),
    ],
    devtool: isProduction ? 'hidden-source-map' : 'nosources-source-map',
    infrastructureLogging: {
      level: 'log',
    },
  };

  return config;
};
