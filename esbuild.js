const esbuild = require('esbuild');
const { execSync } = require('child_process');

// Get BUILD_COMMIT value (same logic as webpack)
function getBuildCommit() {
  // First try CI environment variable
  if (process.env.CI_COMMIT_SHORT_SHA) {
    return process.env.CI_COMMIT_SHORT_SHA;
  }

  // Fall back to git command
  try {
    const commit = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
    return commit;
  } catch (err) {
    console.warn('Could not get git commit, using "dev"');
    return 'dev';
  }
}

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

async function main() {
  if (watch) {
    const ctx = await esbuild.context({
      entryPoints: ['src/extension.ts'],
      bundle: true,
      outfile: 'dist/extension.js',
      external: ['vscode'],
      format: 'cjs',
      platform: 'node',
      target: 'node22',
      sourcemap: !production,
      minify: production,
      define: {
        'BUILD_COMMIT': JSON.stringify(getBuildCommit())
      },
      logLevel: 'info',
    });
    await ctx.watch();
    console.log('Watching for changes...');
  } else {
    await esbuild.build({
      entryPoints: ['src/extension.ts'],
      bundle: true,
      outfile: 'dist/extension.js',
      external: ['vscode'],
      format: 'cjs',
      platform: 'node',
      target: 'node22',
      sourcemap: !production,
      minify: production,
      define: {
        'BUILD_COMMIT': JSON.stringify(getBuildCommit())
      },
      logLevel: 'info',
    });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
