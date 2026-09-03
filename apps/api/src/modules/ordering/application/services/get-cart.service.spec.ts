import { describe, expect, it } from 'vitest';
import { CartId, CustomerId, SkuId } from '../../../../shared/kernel/identifiers';
import { CurrencyMismatchError, Money } from '../../../../shared/kernel/money';
import { Quantity } from '../../../../shared/kernel/quantity';
import { Cart } from '../../domain/cart/cart';
import { FakeCatalogPriceProvider } from '../../testing/fake-catalog-price.provider';
import { InMemoryCartRepository } from '../../testing/in-memory-cart.repository';
import { cartUuid, customerUuid, skuUuid } from '../../testing/ordering.fixtures';
import { GetCartService } from './get-cart.service';

const CUSTOMER = customerUuid('1');
const SKU_A = skuUuid('1');
const SKU_B = skuUuid('2');

async function build(lines: Array<[string, number]>, options: { usdSkuB?: boolean } = {}) {
  const carts = new InMemoryCartRepository();
  const catalog = new FakeCatalogPriceProvider()
    .put(SkuId.of(SKU_A), '티셔츠 RED-M', Money.of(1200n))
    .put(SkuId.of(SKU_B), '모자 BLACK', Money.of(500n, options.usdSkuB === true ? 'USD' : 'KRW'));

  if (lines.length > 0) {
    const cart = Cart.create({
      id: CartId.of(cartUuid('1')),
      customerId: CustomerId.of(CUSTOMER),
    });
    for (const [skuId, quantity] of lines) {
      cart.addItem(SkuId.of(skuId), Quantity.positive(quantity));
    }
    await carts.save(cart);
  }
  return { service: new GetCartService(carts, catalog), carts };
}

const get = (service: GetCartService) => service.execute({ customerId: CUSTOMER });

describe('GetCartService', () => {
  it('장바구니가 없으면 빈 뷰를 돌려준다 — 404가 아니다', async () => {
    // 처음 방문한 고객의 장바구니는 "없는 것"이 아니라 "빈 것"이다.
    const { service } = await build([]);

    expect(await get(service)).toEqual({
      cartId: null,
      lines: [],
      total: { amount: '0', currency: 'KRW' },
      unavailableSkuIds: [],
    });
  });

  it('줄마다 현재 가격과 소계가 붙는다', async () => {
    const { service } = await build([[SKU_A, 3]]);

    const view = await get(service);

    expect(view.lines[0]).toEqual({
      skuId: SKU_A,
      nameSnapshot: '티셔츠 RED-M',
      unitPrice: { amount: '1200', currency: 'KRW' },
      quantity: 3,
      subtotal: { amount: '3600', currency: 'KRW' },
    });
  });

  it('총액이 소계의 합이다', async () => {
    const { service } = await build([
      [SKU_A, 3],
      [SKU_B, 2],
    ]);

    expect((await get(service)).total).toEqual({ amount: '4600', currency: 'KRW' });
  });

  it('Catalog가 모르는 SKU는 unavailableSkuIds에 담기고 총액에서 빠진다', async () => {
    // 판매 중지된 상품 하나 때문에 장바구니 화면 전체가 열리지 않으면 안 된다.
    const { service } = await build([
      [SKU_A, 1],
      [skuUuid('9'), 5],
    ]);

    const view = await get(service);

    expect(view.lines.map((line) => line.skuId)).toEqual([SKU_A]);
    expect(view.unavailableSkuIds).toEqual([skuUuid('9')]);
    expect(view.total).toEqual({ amount: '1200', currency: 'KRW' });
  });

  it('통화가 섞이면 CurrencyMismatchError다 — 500이다', async () => {
    // 카탈로그 데이터가 잘못됐다는 뜻이고 사용자가 고칠 수 있는 것이 없다.
    const { service } = await build(
      [
        [SKU_A, 1],
        [SKU_B, 1],
      ],
      { usdSkuB: true },
    );

    await expect(get(service)).rejects.toThrow(CurrencyMismatchError);
  });

  it('비운 장바구니는 cartId를 유지하고 빈 뷰를 준다', async () => {
    // clear() 후 저장된 장바구니는 존재한다 — null과 구분되어야 한다.
    const { service, carts } = await build([[SKU_A, 1]]);
    const cart = await carts.findByCustomerId(CustomerId.of(CUSTOMER));
    cart?.clear();
    if (cart) {
      await carts.save(cart);
    }

    const view = await get(service);

    expect(view.cartId).toBe(cartUuid('1'));
    expect(view.lines).toHaveLength(0);
  });
});
