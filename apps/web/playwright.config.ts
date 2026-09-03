import { defineConfig, devices } from '@playwright/test';

const WEB_PORT = 3100;
const API_PORT = 3101;

/**
 * 두 서버를 Playwright가 띄운다. 포트를 개발용(3000/3001)과 다르게 두는 이유:
 * 개발 서버를 켜둔 채로 E2E를 돌릴 수 있어야 한다.
 *
 * **DB는 띄우지 않는다.** `pnpm db:up`이 먼저 돌아 있어야 하고, 그 전제를 README에
 * 적는다. Playwright가 docker를 관리하면 실패 진단이 두 겹이 된다.
 *
 * `ENABLE_TEST_ENDPOINTS`는 여기서만 켠다 — `.env.example`에 없는 이유가 그것이다(편차 2).
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      // `pnpm --filter @commerce/api dev`가 아니라 스크립트 본문을 직접 부른다.
      // `dev`는 `-r dotenv/config`로 apps/api/.env를 읽는데, dotenv는 **이미 있는**
      // 환경변수를 덮어쓰지 않으므로 아래 env가 이긴다. 그래서 스크립트를 그대로 쓴다.
      command: 'pnpm --filter @commerce/api dev',
      port: API_PORT,
      reuseExistingServer: !process.env['CI'],
      env: {
        PORT: String(API_PORT),
        ENABLE_TEST_ENDPOINTS: 'true',
        // 스케줄러를 켠다 — TTL 자가치유가 도는 환경이어야 사가가 진짜다.
        // 다만 어떤 시나리오도 15분을 기다리지 않는다.
        SCHEDULERS_ENABLED: 'true',
      },
      timeout: 120_000,
    },
    {
      // `pnpm --filter @commerce/web dev -- -p 3100`이 아니라 `next dev`를 직접 부른다.
      // `dev` 스크립트가 이미 `-p 3000`을 담고 있어서 `--`로 덧붙이면 `-p`가 두 번
      // 들어가고, 어느 쪽이 이기는지는 Next의 인자 파서에 달린 우연이 된다.
      command: `pnpm --filter @commerce/web exec next dev -p ${WEB_PORT}`,
      port: WEB_PORT,
      reuseExistingServer: !process.env['CI'],
      env: {
        API_BASE_URL: `http://localhost:${API_PORT}`,
        SESSION_PASSWORD: 'e2e-only-session-password-32-characters',
      },
      timeout: 120_000,
    },
  ],
});
