import { config } from 'dotenv';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

config({ path: 'apps/api/.env' });

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'contracts',
          include: ['packages/contracts/src/**/*.spec.ts'],
          environment: 'node',
        },
      },
      {
        plugins: [swc.vite({ module: { type: 'es6' } })],
        test: {
          name: 'api-unit',
          include: ['apps/api/src/**/*.spec.ts'],
          exclude: ['**/*.integration.spec.ts'],
          environment: 'node',
        },
      },
      {
        plugins: [swc.vite({ module: { type: 'es6' } })],
        test: {
          name: 'api-integration',
          include: ['apps/api/**/*.integration.spec.ts'],
          environment: 'node',
          globalSetup: ['./apps/api/test/setup/global-setup.ts'],
          setupFiles: ['./apps/api/test/setup/integration-setup.ts'],
          fileParallelism: true,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
    coverage: {
      thresholds: {
        'apps/api/src/shared/kernel/**': { lines: 95, branches: 90 },
      },
    },
  },
});
