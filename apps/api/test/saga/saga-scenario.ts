import type { SagaHarness } from './saga-support';

/**
 * 보상 스위트 셋이 공유하는 준비. 상품 1종·SKU 1개·재고 `onHand`·장바구니 3개.
 *
 * `place-order.integration.spec.ts`가 자기 안에 같은 함수를 두는 대신 여기서
 * 가져오지 않는 이유: 그 파일은 `onHand`를 바꿀 필요가 없어 시그니처가 더 단순하다.
 * 여기서는 재고 부족을 만들어야 하므로 인자가 하나 더 있다.
 */
export async function scenario(
  harness: SagaHarness,
  email: string,
  options: { onHand?: number; cartQuantity?: number } = {},
): Promise<{ token: string; productId: string; skuId: string }> {
  const { token } = await harness.signUp(email);
  const { productId, skuIds } = await harness.registerProduct(token, {
    name: '티셔츠',
    skus: [{ code: 'RED-M', price: { amount: '12000', currency: 'KRW' } }],
  });
  const skuId = skuIds[0] as string;
  await harness.registerStock(token, skuId, options.onHand ?? 10);
  await harness.addToCart(token, skuId, options.cartQuantity ?? 3);
  return { token, productId, skuId };
}
