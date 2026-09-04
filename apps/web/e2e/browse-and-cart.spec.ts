import { addToCart, expect, signIn, test } from './fixtures';

test('상품 목록에서 상세로 들어간다', async ({ page, api }) => {
  const { token } = await api.signUp();
  await api.registerCatalog(token, { onHand: 10 });

  await page.goto('/');

  // 다른 테스트가 만든 상품도 목록에 있으므로 첫 카드가 아니라 링크의 존재를 본다.
  const firstProduct = page.getByRole('link', { name: /^티셔츠-/ }).first();
  await expect(firstProduct).toBeVisible();
  const name = await firstProduct.innerText();
  await firstProduct.click();

  // 이동을 먼저 기다린다. 목록 페이지의 카드 제목도 `/^티셔츠-/`에 걸리므로,
  // URL을 확인하지 않으면 아직 목록에 있는 동안 여러 개가 잡혀 strict 모드가 깨진다.
  await expect(page).toHaveURL(/\/products\/[0-9a-f-]+$/);
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
