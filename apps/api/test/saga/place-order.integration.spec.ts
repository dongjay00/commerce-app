import { describe, expect, it } from 'vitest';
import { SagaHarness } from './saga-support';

/** 세 케이스가 공유하는 준비. 상품 1종·SKU 1개·재고 10·장바구니 3개. */
async function scenario(harness: SagaHarness, email: string) {
  const { token } = await harness.signUp(email);
  const { productId, skuIds } = await harness.registerProduct(token, {
    name: '티셔츠',
    skus: [{ code: 'RED-M', price: { amount: '12000', currency: 'KRW' } }],
  });
  const skuId = skuIds[0] as string;
  await harness.registerStock(token, skuId, 10);
  await harness.addToCart(token, skuId, 3);
  return { token, productId, skuId };
}

describe('사가 — 주문 성공', () => {
  it('장바구니 → 주문 → 결제 승인 → 예약 확정까지 관통한다', async () => {
    const harness = await SagaHarness.boot();
    try {
      const { token, skuId } = await scenario(harness, 'saga-success@example.com');
      const addressId = await harness.addAddress(token);

      // 1) 주문 = 사가
      const placed = await harness.placeOrder(token, addressId);
      expect(placed.status).toBe('PAID');

      // 2) 이 시점에는 예약이 잡혀 있고 아직 확정되지 않았다.
      //    OrderPaid는 outbox에 있을 뿐 아직 배달되지 않았다.
      expect(await harness.stockOf(token, skuId)).toEqual({
        skuId,
        onHand: 10,
        reserved: 3,
        available: 7,
      });

      // 3) 릴레이를 돌려 이벤트를 배달한다.
      await harness.drainOutbox();

      // 4) 예약이 확정되어 보유량이 차감됐다.
      expect(await harness.stockOf(token, skuId)).toEqual({
        skuId,
        onHand: 7,
        reserved: 0,
        available: 7,
      });

      // 5) 주문 상세가 스냅샷을 담고 있다.
      const order = await harness.orderOf(token, placed.orderId);
      expect(order.total).toEqual({ amount: '36000', currency: 'KRW' });
      expect(order.lines[0]?.nameSnapshot).toBe('티셔츠 RED-M');
      expect(order.shippingAddress.recipient).toBe('홍길동');

      // 6) 장바구니가 비었다.
      expect((await harness.cartOf(token)).lines).toHaveLength(0);
    } finally {
      await harness.close();
    }
  });

  it('상품 가격이 바뀌어도 과거 주문 금액은 그대로다', async () => {
    // 스펙 §5.3의 스냅샷 규칙. 이것이 깨지면 회계가 무너진다.
    const harness = await SagaHarness.boot();
    try {
      const { token, productId, skuId } = await scenario(harness, 'saga-snapshot@example.com');
      const placed = await harness.placeOrder(token, await harness.addAddress(token));
      await harness.drainOutbox();

      await harness.changePrice(token, productId, skuId, { amount: '99000', currency: 'KRW' });

      const order = await harness.orderOf(token, placed.orderId);
      expect(order.total).toEqual({ amount: '36000', currency: 'KRW' });
      expect(order.lines[0]?.unitPrice).toEqual({ amount: '12000', currency: 'KRW' });
    } finally {
      await harness.close();
    }
  });

  it('outbox가 두 번 배달돼도 재고가 두 번 차감되지 않는다', async () => {
    // at-least-once 멱등성. 편차 5(SKIP LOCKED를 넣지 않는다)를 갚는 자리다.
    const harness = await SagaHarness.boot();
    try {
      const { token, skuId } = await scenario(harness, 'saga-redeliver@example.com');
      await harness.placeOrder(token, await harness.addAddress(token));
      await harness.drainOutbox();
      const afterFirst = await harness.stockOf(token, skuId);

      // 릴레이가 두 번 집는 상황을 재현한다 — 인스턴스가 둘일 때 실제로 일어난다.
      await harness.resetPublished('ordering.OrderPaid');
      await harness.drainOutbox();

      expect(await harness.stockOf(token, skuId)).toEqual(afterFirst);
    } finally {
      await harness.close();
    }
  });
});
