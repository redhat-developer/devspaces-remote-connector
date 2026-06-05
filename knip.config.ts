import type { KnipConfig } from 'knip';

const config: KnipConfig = {
  project: ['src/**/*.ts'],
  ignoreDependencies: [
    'jest-junit', // used in CI
  ],
  // Exported types/interfaces are part of the public API — don't flag them
  ignoreExportsUsedInFile: true,
};

export default config;
