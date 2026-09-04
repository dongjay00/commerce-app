import { defineConfig, devices } from '@playwright/test';

const WEB_PORT = 3100;
const API_PORT = 3101;

/** `e2e/session.spec.ts`가 이 값을 읽어 만료를 기다린다. */
export const ACCESS_TOKEN_TTL_SECONDS = 15;

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
        // `e2e/session.spec.ts`가 만료를 실제로 기다린다(15분이 아니라 15초).
        // **더 짧게 두면 안 된다.** C1의 결정대로 RSC 렌더가 만료를 만나면 화면이
        // 로그인으로 보내지므로, 이 값이 다른 시나리오의 "쿠키를 쓴 마지막 요청 →
        // 다음 RSC 조회" 간격보다 짧아지는 순간 무관한 테스트가 로그인 화면으로
        // 튕겨 빨개진다. 리뷰가 제안한 2초로 실제로 돌려 보면 browse-and-cart
        // 세 시나리오가 각각 1.7~2.7초에 끝난다 — 시나리오 하나의 전체 길이가
        // TTL과 같은 크기라 여유가 없다. 자세한 것은 계획서 부록에 적었다.
        ACCESS_TOKEN_TTL_SECONDS: String(ACCESS_TOKEN_TTL_SECONDS),
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
