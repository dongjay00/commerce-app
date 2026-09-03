import { expect, test } from './fixtures';

test('두 서버가 뜨고 상품 목록이 열린다', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '상품' })).toBeVisible();
});

test('시드 API가 동작한다', async ({ api }) => {
  const { token } = await api.signUp();
  const { skuId } = await api.registerCatalog(token, { onHand: 5 });

  expect(await api.stockOf(token, skuId)).toMatchObject({ onHand: 5, reserved: 0 });
});

test('PG 시나리오를 바꿀 수 있다', async ({ api }) => {
  // 편차 2의 엔드포인트가 실제로 켜져 있는지 확인한다.
  await api.setPgScenario('DECLINE');
  await api.setPgScenario('APPROVE');
});
