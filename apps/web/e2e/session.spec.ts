import { ACCESS_TOKEN_TTL_SECONDS } from '../playwright.config';
import { expect, signIn, test } from './fixtures';

/**
 * C1의 회귀 테스트. **여기가 진짜 `cookieTokenStore`를 상대로 토큰 갱신을 돌리는
 * 유일한 자리다** — `api-client.spec.ts`의 401 재시도 테스트 열두 개는 전부
 * `InMemoryTokenStore`를 쓰므로 "이 컨텍스트에서 쿠키를 쓸 수 있는가"라는 질문
 * 자체가 존재하지 않는다.
 *
 * Next는 RSC 렌더 중 쿠키 수정을 금지한다(Route Handler와 Server Action에서는
 * 허용한다). 그래서 RSC가 401을 만나 토큰을 갱신하면 새 토큰을 쿠키에 담을 수 없다.
 * 고치기 전에는 그 순간 화면이 **500**으로 죽었고, 복구 경로(`store.clear()`)까지
 * 같은 쿠키 오류로 죽어서 `SessionExpiredError`가 나오지 않아 로그인으로도 못 갔다 —
 * 사용자가 쿠키를 직접 지울 때까지 영구히 500이었다.
 *
 * 고친 뒤의 계약은 "500이 아니라 로그인 화면"이다. 갱신을 미들웨어로 옮기면
 * `/cart`에 그대로 머물게 되므로, 두 결말을 모두 통과로 본다.
 */
test('액세스 토큰이 만료된 뒤 조회 화면을 열어도 죽지 않는다', async ({ page, api }) => {
  const crashes: string[] = [];
  page.on('pageerror', (error) => crashes.push(String(error)));

  const { email, password } = await api.signUp();
  await signIn(page, { email, password });

  // 액세스 토큰만 만료된다 — 리프레시 토큰은 아직 살아 있어서 RSC가 갱신을 시도한다.
  await page.waitForTimeout(ACCESS_TOKEN_TTL_SECONDS * 1_000 + 1_000);

  // (1) 갱신이 필요한 첫 요청 — `store.write`가 RSC에서 쿠키를 쓰지 못하는 자리다.
  const first = await page.goto('/cart');
  expect(first?.status(), 'RSC에서 갱신이 필요하면 500으로 죽었다').toBeLessThan(500);
  await expect(page).toHaveURL(/\/(cart|sign-in)$/);

  // (2) 같은 쿠키로 다시 연다. 첫 시도에서 서버가 리프레시 토큰을 이미 회전시켜
  //     태웠으므로 이번엔 갱신 자체가 실패하고 `store.clear()`가 불린다 — 그 경로도
  //     쿠키를 쓰므로 함께 죽었다. 사용자가 갇히지 않는다는 것이 여기서 갈린다.
  const second = await page.goto('/cart');
  expect(second?.status(), '갱신 실패 복구 경로도 500으로 죽었다').toBeLessThan(500);
  await expect(page).toHaveURL(/\/(cart|sign-in)$/);

  // 로그인 화면으로 보냈다면 다시 로그인할 수 있어야 한다 — 그것이 "갇히지 않았다"의 뜻이다.
  if (new URL(page.url()).pathname === '/sign-in') {
    await expect(page.getByRole('button', { name: '로그인' })).toBeVisible();
  }

  expect(crashes).toEqual([]);
});
