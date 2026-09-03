import { type APIRequestContext, test as base, expect, type Page } from '@playwright/test';

const API = process.env['E2E_API_BASE_URL'] ?? 'http://localhost:3101';

let sequence = 0;

/** 시나리오마다 다른 값을 쓴다 — DB를 비우지 않으므로 충돌을 피해야 한다. */
function uniqueSuffix(): string {
  sequence += 1;
  return `${Date.now().toString(36)}${sequence.toString(36)}`;
}

export interface SeedApi {
  signUp(): Promise<{ email: string; password: string; token: string }>;
  registerCatalog(
    token: string,
    options: { onHand: number },
  ): Promise<{ productId: string; skuId: string }>;
  /**
   * **전역 상태를 바꾼다.** `FakePgAdapter`는 API 프로세스 하나에 인스턴스 하나라,
   * 병렬로 도는 두 시나리오가 서로의 설정을 덮어쓴다. 결제 시나리오를 바꾸는
   * 테스트는 반드시 `test.describe.serial`로 묶고, 끝날 때 `APPROVE`로 되돌린다.
   */
  setPgScenario(scenario: 'APPROVE' | 'DECLINE' | 'TIMEOUT'): Promise<void>;
  stockOf(
    token: string,
    skuId: string,
  ): Promise<{ onHand: number; reserved: number; available: number }>;
}

function makeSeedApi(request: APIRequestContext): SeedApi {
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  return {
    async signUp() {
      const email = `e2e-${uniqueSuffix()}@example.com`;
      const password = 'correct horse battery staple';
      const response = await request.post(`${API}/auth/sign-up`, { data: { email, password } });
      expect(response.status(), await response.text()).toBe(201);
      return { email, password, token: (await response.json()).accessToken };
    },

    async registerCatalog(token, options) {
      const product = await request.post(`${API}/products`, {
        headers: auth(token),
        data: {
          name: `티셔츠-${uniqueSuffix()}`,
          skus: [{ code: 'RED-M', price: { amount: '12000', currency: 'KRW' } }],
        },
      });
      expect(product.status(), await product.text()).toBe(201);
      const body = await product.json();
      const skuId = body.skus[0].id as string;

      return { productId: body.id as string, skuId };
    },

    async setPgScenario(scenario) {
      // 편차 2의 테스트 전용 엔드포인트. playwright.config.ts가 플래그를 켠다.
      const response = await request.post(`${API}/testing/pg-scenario`, { data: { scenario } });
      expect(response.status(), await response.text()).toBe(204);
    },

    async stockOf(token, skuId) {
      const response = await request.get(`${API}/stock/${skuId}`, { headers: auth(token) });
      expect(response.status(), await response.text()).toBe(200);
      return response.json();
    },
  };
}

export const test = base.extend<{ api: SeedApi }>({
  api: async ({ request }, use) => {
    await use(makeSeedApi(request));
  },
});

export { expect } from '@playwright/test';

/** UI로 로그인한다 — 쿠키를 직접 심지 않는다. 로그인 흐름 자체가 검증 대상이다. */
export async function signIn(
  page: Page,
  credentials: { email: string; password: string },
): Promise<void> {
  await page.goto('/sign-in');
  await page.getByLabel('이메일').fill(credentials.email);
  await page.getByLabel('비밀번호').fill(credentials.password);
  await page.getByRole('button', { name: '로그인' }).click();
  await expect(page.getByRole('button', { name: '로그아웃' })).toBeVisible();
}
