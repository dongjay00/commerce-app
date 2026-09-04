import { randomUUID } from 'node:crypto';
import { type APIRequestContext, test as base, expect, type Page } from '@playwright/test';

const API = process.env['E2E_API_BASE_URL'] ?? 'http://localhost:3101';

let sequence = 0;

/**
 * 시나리오마다 다른 값을 쓴다 — DB를 비우지 않으므로 충돌을 피해야 한다.
 *
 * `sequence`는 **워커 프로세스마다** 따로 세어진다. 그래서 시각과 순번만으로는
 * 부족하다: 두 워커가 같은 밀리초에 첫 사용자를 만들면 이메일이 똑같아지고
 * `EMAIL_ALREADY_REGISTERED`(409)가 난다. 실제로 이 경합이 스위트를 간헐적으로
 * 실패시켰다. 프로세스마다 다른 무작위 조각을 섞어 그것을 없앤다.
 */
const processTag = randomUUID().slice(0, 8);

function uniqueSuffix(): string {
  sequence += 1;
  return `${Date.now().toString(36)}${processTag}${sequence.toString(36)}`;
}

/** 카운트다운의 기준점. 이 시각을 넘기기 전에 상점에 페이지네이션이 생길 것이다. */
const NAME_EPOCH_MS = 2_000_000_000_000;

/**
 * 상품 이름을 **시각의 내림차순**으로 만든다 — 방금 만든 것이 사전순 맨 앞이다.
 *
 * 상점 목록(`app/page.tsx`)은 이름 오름차순으로 20개만 가져오고 페이지네이션이
 * 없다(최종 리뷰 m8). E2E는 DB를 비우지 않으므로 이전 실행이 남긴 상품이 계속
 * 쌓이고, 이름을 시각의 **오름차순**으로 두면 방금 등록한 상품은 목록 끝으로 밀려
 * 첫 페이지에서 영영 보이지 않는다. 그러면 첫 시나리오가 자기가 만든 상품을
 * 단언할 수 없다(최종 리뷰 I1).
 *
 * 자릿수를 고정하는 것이 핵심이다 — 폭이 변하면 사전순과 시간순이 어긋난다.
 *
 * **제대로 된 해법은 목록을 최신순으로 정렬하는 것이다**(리뷰가 제안한 둘 중 하나).
 * 그건 상점의 동작을 바꾸는 일이라 이 수정 묶음의 범위 밖이고, 계획서 부록에 이월했다.
 */
function descendingNameTag(): string {
  return (NAME_EPOCH_MS - Date.now()).toString(36).padStart(9, '0');
}

export interface SeedApi {
  signUp(): Promise<{ email: string; password: string; token: string }>;
  /**
   * 상품·SKU·재고를 만든다. **만든 이름을 돌려준다** — 시나리오가 "아무 티셔츠"가
   * 아니라 자기가 등록한 상품을 단언할 수 있어야 한다(최종 리뷰 I1).
   */
  registerCatalog(
    token: string,
    options: { onHand: number },
  ): Promise<{ productId: string; skuId: string; name: string }>;
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
      // 카운트다운이 순서를 정하고 `uniqueSuffix()`가 유일성을 맡는다 — 같은
      // 밀리초에 두 개를 만들면 이름이 겹쳐 `getByRole('link', { name })`이
      // 둘을 잡고 strict 모드가 깨진다.
      const name = `티셔츠-${descendingNameTag()}-${uniqueSuffix()}`;
      const product = await request.post(`${API}/products`, {
        headers: auth(token),
        data: {
          name,
          skus: [{ code: 'RED-M', price: { amount: '12000', currency: 'KRW' } }],
        },
      });
      expect(product.status(), await product.text()).toBe(201);
      const body = await product.json();
      const skuId = body.skus[0].id as string;

      const stock = await request.post(`${API}/stock`, {
        headers: auth(token),
        data: { skuId, onHand: options.onHand },
      });
      expect(stock.status(), await stock.text()).toBe(201);

      return { productId: body.id as string, skuId, name };
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

/**
 * 화면이 띄운 경고만 고른다.
 *
 * Next가 모든 페이지의 `<body>`에 라우트 안내용
 * `<div role="alert" aria-live="assertive" id="__next-route-announcer__">`를 넣는다.
 * 그래서 `page.getByRole('alert')`는 이 앱에서 **절대 유일하지 않고**,
 * `toHaveCount(0)`은 영영 참이 되지 않는다. 안내자는 `<main>` 밖이라
 * `main`으로 좁히면 우리 경고만 남는다.
 */
export function appAlert(page: Page) {
  return page.getByRole('main').getByRole('alert');
}

/**
 * 담기 버튼은 눌러도 화면이 눈에 띄게 바뀌지 않는다 — `onAdded`가 `router.refresh()`를
 * 부를 뿐이라 확인 문구가 없다. 그래서 클릭 직후 `page.goto`로 넘어가면 POST가
 * 끝나기 전에 이동해 장바구니가 비어 보인다(실제로 이 경합이 태스크 13의 두 테스트를
 * 간헐적으로 실패시켰다). BFF 응답을 기다려 그 경합을 없앤다.
 */
export async function addToCart(page: Page): Promise<void> {
  const added = page.waitForResponse(
    (response) =>
      response.url().includes('/api/cart/items') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: '장바구니에 담기' }).click();
  await added;
}

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
