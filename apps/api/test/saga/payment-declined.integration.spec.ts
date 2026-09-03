import { describe, expect, it } from 'vitest';
import { scenario } from './saga-scenario';
import { SagaHarness } from './saga-support';

describe('사가 — 결제 거절 보상', () => {
  it('거절되면 주문이 PAYMENT_FAILED로 끝나고 예약이 해제된다', async () => {
    const harness = await SagaHarness.boot();
    try {
      const { token, skuId } = await scenario(harness, 'saga-declined@example.com');
      // FakePgAdapter를 DI에서 꺼내 시나리오를 바꾼다. 매직 금액을 쓰지 않는
      // 이유는 fake-pg.adapter.ts의 주석에 있다.
      harness.pg().scenario = 'DECLINE';

      const placed = await harness.placeOrder(token, await harness.addAddress(token));

      // 주문은 만들어졌다. 4xx가 아니라 201이고 상태가 결과를 말한다.
      expect(placed.status).toBe('PAYMENT_FAILED');

      // 이 시점에 예약은 아직 잡혀 있다 — 해제는 이벤트로 간다.
      expect(await harness.stockOf(token, skuId)).toMatchObject({ onHand: 10, reserved: 3 });

      await harness.drainOutbox();

      // 예약이 해제되어 재고가 완전히 돌아왔다.
      expect(await harness.stockOf(token, skuId)).toEqual({
        skuId,
        onHand: 10,
        reserved: 0,
        available: 10,
      });
    } finally {
      await harness.close();
    }
  });

  it('거절된 주문은 조회에서도 PAYMENT_FAILED다', async () => {
    const harness = await SagaHarness.boot();
    try {
      const { token } = await scenario(harness, 'saga-declined-view@example.com');
      harness.pg().scenario = 'DECLINE';
      const placed = await harness.placeOrder(token, await harness.addAddress(token));
      await harness.drainOutbox();

      expect((await harness.orderOf(token, placed.orderId)).status).toBe('PAYMENT_FAILED');
    } finally {
      await harness.close();
    }
  });

  it('재고가 부족하면 409이고 재고가 그대로다', async () => {
    // 예약 단계 실패는 이벤트가 아니라 예외로 나간다 — 클라이언트가 즉시 안다.
    const harness = await SagaHarness.boot();
    try {
      // 장바구니에 3개를 담는데 재고는 1개다.
      const { token, skuId } = await scenario(harness, 'saga-oos@example.com', { onHand: 1 });

      const failed = await harness.tryPlaceOrder(token, await harness.addAddress(token));

      expect(failed.status).toBe(409);
      expect(failed.body.code).toBe('INSUFFICIENT_STOCK');
      expect(await harness.stockOf(token, skuId)).toMatchObject({ onHand: 1, reserved: 0 });
    } finally {
      await harness.close();
    }
  });

  it('재고 부족으로 실패한 주문은 PAYMENT_FAILED로 끝난다 — PENDING_PAYMENT로 남지 않는다', async () => {
    // 이 스위트가 찾은 결함이다. 주문은 `assemble` 트랜잭션에서 이미 만들어졌고
    // 장바구니는 지워졌다. PENDING_PAYMENT로 두면 TTL 스캔이 훑을 예약도 없어
    // 아무도 그 주문을 끝내지 않고, 고객의 목록에 "결제 대기"가 영구히 걸린다.
    const harness = await SagaHarness.boot();
    try {
      const { token } = await scenario(harness, 'saga-oos-order@example.com', { onHand: 1 });
      await harness.tryPlaceOrder(token, await harness.addAddress(token));
      await harness.drainOutbox();

      const orders = await harness.listOrders(token);
      expect(orders).toHaveLength(1);
      expect(orders[0]?.status).toBe('PAYMENT_FAILED');
    } finally {
      await harness.close();
    }
  });
});
