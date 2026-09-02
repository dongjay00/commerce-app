import { config } from 'dotenv';
import { defineConfig } from 'vitest/config';

config({ path: 'apps/api/.env' });

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'api-unit',
          include: ['apps/api/src/**/*.spec.ts'],
          exclude: ['**/*.integration.spec.ts'],
          environment: 'node',
        },
      },
      {
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
