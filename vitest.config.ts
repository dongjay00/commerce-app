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
      {
        test: {
          name: 'web',
          include: ['apps/web/src/**/*.spec.{ts,tsx}'],
          environment: 'jsdom',
          setupFiles: ['./apps/web/test/setup.ts'],
        },
      },
    ],
    coverage: {
      thresholds: {
        'apps/api/src/shared/kernel/**': { lines: 95, branches: 90 },
        // modules/*는 계획 2 전까지 빈 디렉터리라 글롭이 아무것도 매치하지 않는다.
        // Vitest는 매치 없는 글롭 임계값을 조용히 통과시키므로, 이 두 줄이 있어도
        // 지금 당장은 아무것도 검증하지 않는다 — 계획 2가 modules/*/domain,
        // modules/*/application을 채우는 순간부터 의미가 생긴다.
        'apps/api/src/modules/*/domain/**': { lines: 95, branches: 90 },
        'apps/api/src/modules/*/application/**': { lines: 90, branches: 85 },
      },
    },
  },
});
