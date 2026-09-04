import type { Page } from '@playwright/test';
import { addToCart, appAlert, expect, type SeedApi, signIn, test } from './fixtures';

/** 한 시나리오의 준비: 사용자·상품·재고·로그인·장바구니·배송지. */
async function readyToOrder(
  page: Page,
  api: SeedApi,
  options: { onHand: number; quantity: number },
) {
  const { email, password, token } = await api.signUp();
  const { productId, skuId } = await api.registerCatalog(token, { onHand: options.onHand });
  await signIn(page, { email, password });

  await page.goto(`/products/${productId}`);
  await page.getByLabel('수량').fill(String(options.quantity));
  await addToCart(page);
  await expect(appAlert(page)).toHaveCount(0);

  await page.goto('/cart');
  // 배송지가 없으므로 추가 폼이 보인다 — 그것이 첫 주문의 실제 경험이다.
  await page.getByLabel('받는 사람').fill('홍길동');
  await page.getByLabel('연락처').fill('010-1234-5678');
  await page.getByLabel('우편번호').fill('06236');
  await page.getByLabel('주소').fill('서울시 강남구 테헤란로 1');

  // 담기와 같은 이유로 응답을 기다린다 — 추가가 끝나야 `onSelect`가 배송지를 고르고
  // 주문 버튼의 `disabled`가 풀린다.
  const added = page.waitForResponse(
    (response) =>
      response.url().includes('/api/addresses') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: '배송지 추가' }).click();
  await added;

  return { token, skuId };
}

test.describe
  .serial('결제', () => {
    test.afterAll(async ({ api }) => {
      // 전역 상태를 되돌린다 — 다음 파일이 승인 경로를 기대한다.
      await api.setPgScenario('APPROVE');
    });

    test('주문이 성공하면 결제 완료로 끝나고 재고가 차감된다', async ({ page, api }) => {
      await api.setPgScenario('APPROVE');
      const { token, skuId } = await readyToOrder(page, api, { onHand: 10, quantity: 2 });

      await page.getByRole('button', { name: '주문하기' }).click();

      await expect(page).toHaveURL(/\/orders\/[0-9a-f-]+$/);
      await expect(page.getByText('결제 완료')).toBeVisible();
      await expect(page.getByText('총 24,000원')).toBeVisible();

      // 예약 확정은 outbox 릴레이가 배달한 뒤에 일어난다 — 스케줄러가 켜져 있으므로
      // 곧 반영된다. 폴링으로 기다린다(스펙 §9.10의 `expect.poll`).
      await expect
        .poll(async () => (await api.stockOf(token, skuId)).onHand, { timeout: 15_000 })
        .toBe(8);
    });

    test('결제가 거절되면 그 사실이 보이고 재고 예약이 해제된다', async ({ page, api }) => {
      // 스펙 §9.10의 예시가 그대로 이 시나리오다.
      await api.setPgScenario('DECLINE');
      const { token, skuId } = await readyToOrder(page, api, { onHand: 10, quantity: 2 });

      await page.getByRole('button', { name: '주문하기' }).click();

      // 주문은 만들어졌다 — 4xx가 아니라 201이고 상태가 결과를 말한다(계획 4).
      await expect(page).toHaveURL(/\/orders\/[0-9a-f-]+$/);
      await expect(page.getByText('결제가 거절되었습니다.')).toBeVisible();

      // 보상: OrderPaymentFailed → Inventory 구독 → 예약 해제.
      await expect
        .poll(async () => await api.stockOf(token, skuId), { timeout: 15_000 })
        .toMatchObject({ onHand: 10, reserved: 0 });
    });

    test('결제된 주문을 취소하면 환불이 시작되고 재고가 복원된다', async ({ page, api }) => {
      await api.setPgScenario('APPROVE');
      const { token, skuId } = await readyToOrder(page, api, { onHand: 10, quantity: 2 });
      await page.getByRole('button', { name: '주문하기' }).click();
      await expect(page.getByText('결제 완료')).toBeVisible();
      await expect
        .poll(async () => (await api.stockOf(token, skuId)).onHand, { timeout: 15_000 })
        .toBe(8);

      await page.getByRole('button', { name: '주문 취소' }).click();

      // 계획 4의 편차 1: 환불이 끝날 때까지 REFUND_PENDING이다.
      await expect(page.getByText(/환불 처리 중|환불 완료/)).toBeVisible();

      // 확정으로 차감됐던 보유량이 되돌아온다 — release가 아니라 restore다.
      await expect
        .poll(async () => (await api.stockOf(token, skuId)).onHand, { timeout: 15_000 })
        .toBe(10);
    });

    test('재고가 부족하면 주문이 거절되고 그 이유가 보인다', async ({ page, api }) => {
      // URL이 `/cart`에 머무는 것만으로는 "올바르게 머물렀다"와 "떠나려다 터졌다"를
      // 구분하지 못한다 — 핸들러가 던지면 이동이 시작되지도 않아 URL이 똑같다.
      // 실패해도 `onPlaced`를 부르는 회귀가 정확히 그 모양이라, 던진 예외를 본다.
      const crashes: string[] = [];
      page.on('pageerror', (error) => crashes.push(String(error)));

      await api.setPgScenario('APPROVE');
      // 재고 1개인데 3개를 담는다.
      const { token, skuId } = await readyToOrder(page, api, { onHand: 1, quantity: 3 });

      await page.getByRole('button', { name: '주문하기' }).click();

      // 예약 단계 실패는 예외로 나온다(409) — 주문 페이지로 이동하지 않는다.
      await expect(appAlert(page)).toHaveText('재고가 부족합니다.');
      await expect(page).toHaveURL(/\/cart$/);

      // 예약이 잡혔다가 풀렸으므로 재고는 그대로다.
      expect(await api.stockOf(token, skuId)).toMatchObject({ onHand: 1, reserved: 0 });
      expect(crashes).toEqual([]);
    });
  });
