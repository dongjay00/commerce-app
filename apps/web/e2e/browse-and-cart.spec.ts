import { addToCart, expect, signIn, test } from './fixtures';

test('방금 등록한 상품이 목록에 보이고 그 상세로 들어간다', async ({ page, api }) => {
  const { token } = await api.signUp();
  const { productId, name } = await api.registerCatalog(token, { onHand: 10 });

  await page.goto('/');

  // **자기가 등록한 상품**을 찾는다. 이전에는 `/^티셔츠-/`로 아무 티셔츠나 골랐고,
  // 그래서 시드를 통째로 지워도 이전 실행이 남긴 상품에 걸려 통과했다(최종 리뷰 I1).
  // 이름으로 찾으면 카탈로그 등록이나 목록 쿼리가 깨질 때 정확히 빨개진다.
  const registered = page.getByRole('link', { name });
  await expect(registered).toBeVisible();
  await registered.click();

  // 이동을 먼저 기다린다 — 아직 목록에 있는 동안 단언하면 카드 제목이 잡힌다.
  await expect(page).toHaveURL(`/products/${productId}`);
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  await expect(page.getByText('12,000원')).toBeVisible();
});

test('상품을 장바구니에 담고 확인한다', async ({ page, api }) => {
  const { email, password, token } = await api.signUp();
  const { productId } = await api.registerCatalog(token, { onHand: 10 });
  await signIn(page, { email, password });

  await page.goto(`/products/${productId}`);
  await page.getByLabel('수량').fill('2');
  await addToCart(page);

  await page.goto('/cart');

  await expect(page.getByRole('cell', { name: /RED-M/ })).toBeVisible();
  await expect(page.getByRole('cell', { name: '2개' })).toBeVisible();
  // 총액은 서버가 계산해 내려준다 — BFF도 프론트도 계산하지 않는다(스펙 §8.1).
  await expect(page.getByText('총 24,000원')).toBeVisible();
});

test('장바구니에서 상품을 뺀다', async ({ page, api }) => {
  const { email, password, token } = await api.signUp();
  const { productId } = await api.registerCatalog(token, { onHand: 10 });
  await signIn(page, { email, password });

  await page.goto(`/products/${productId}`);
  await addToCart(page);
  await page.goto('/cart');
  await expect(page.getByRole('cell', { name: /RED-M/ })).toBeVisible();

  await page.getByRole('button', { name: '빼기' }).click();

  await expect(page.getByText('장바구니가 비어 있습니다.')).toBeVisible();
});
