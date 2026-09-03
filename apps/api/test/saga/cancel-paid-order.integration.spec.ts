import { describe, expect, it } from 'vitest';
import { scenario } from './saga-scenario';
import { SagaHarness } from './saga-support';

describe('사가 — PAID 주문 취소', () => {
  it('취소하면 REFUND_PENDING이 되고, 환불이 끝나면 REFUNDED가 되며 재고가 복원된다', async () => {
    const harness = await SagaHarness.boot();
    try {
      const { token, skuId } = await scenario(harness, 'saga-cancel@example.com');
      const placed = await harness.placeOrder(token, await harness.addAddress(token));
      await harness.drainOutbox();
      // 확정되어 보유량이 차감된 상태에서 시작한다.
      expect(await harness.stockOf(token, skuId)).toMatchObject({ onHand: 7, reserved: 0 });

      // 1) 취소 요청 — 편차 1의 중간 상태
      const cancelled = await harness.cancelOrder(token, placed.orderId);
      expect(cancelled.status).toBe('REFUND_PENDING');

      // 2) OrderCancelled 배달 → Payment 환불 + Inventory 복원
      //    → PaymentRefunded 배달 → 주문 REFUNDED
      await harness.drainOutbox();

      expect((await harness.orderOf(token, placed.orderId)).status).toBe('REFUNDED');
      // 확정으로 차감됐던 보유량이 되돌아왔다 — release가 아니라 restore다.
      expect(await harness.stockOf(token, skuId)).toEqual({
        skuId,
        onHand: 10,
        reserved: 0,
        available: 10,
      });
      expect(harness.pg().refundedTxIds).toHaveLength(1);
    } finally {
      await harness.close();
    }
  });

  it('취소를 두 번 요청해도 환불은 한 번이고 재고도 한 번만 복원된다', async () => {
    // 편차 5를 갚는 두 번째 자리다. 취소 요청이 둘, OrderCancelled 배달도 둘일 수 있다.
    const harness = await SagaHarness.boot();
    try {
      const { token, skuId } = await scenario(harness, 'saga-cancel-twice@example.com');
      const placed = await harness.placeOrder(token, await harness.addAddress(token));
      await harness.drainOutbox();

      await harness.cancelOrder(token, placed.orderId);
      await harness.cancelOrder(token, placed.orderId);
      await harness.drainOutbox();
      await harness.resetPublished('ordering.OrderCancelled');
      await harness.drainOutbox();

      expect(harness.pg().refundedTxIds).toHaveLength(1);
      expect(await harness.stockOf(token, skuId)).toMatchObject({ onHand: 10, reserved: 0 });
      // 재배달된 이벤트를 구독자가 조용히 실패로 넘기면 여기 걸린다 —
      // 멱등하지 않은 구독자는 던지고, 릴레이가 그것을 재시도 큐에 넣는다.
      expect(await harness.failedOutboxCount()).toBe(0);
    } finally {
      await harness.close();
    }
  });

  it('결제 전 주문을 취소하면 CANCELLED가 되고 환불은 없다', async () => {
    // 스펙 §5.4의 표: PENDING_PAYMENT 취소는 "예약 해제만. 돈이 안 오갔음".
    //
    // PG를 TIMEOUT으로 두어 주문을 PENDING_PAYMENT로 남긴다. 그 경로는
    // PlaceOrderService가 예약을 이미 풀었으므로 취소 시점에 예약은 RELEASED이고,
    // OrderCancelled(wasPaid: false) → release는 false를 돌려주는 no-op이다.
    // **이 케이스가 검증하는 것은 "재고가 돌아왔다"가 아니라 "환불이 없었다"이다.**
    const harness = await SagaHarness.boot();
    try {
      const { token, skuId } = await scenario(harness, 'saga-cancel-pending@example.com');
      harness.pg().scenario = 'TIMEOUT';
      await harness.tryPlaceOrder(token, await harness.addAddress(token));

      const [summary] = await harness.listOrders(token);
      expect(summary?.status).toBe('PENDING_PAYMENT');

      harness.pg().scenario = 'APPROVE';
      const cancelled = await harness.cancelOrder(token, summary?.id as string);
      expect(cancelled.status).toBe('CANCELLED');

      await harness.drainOutbox();

      expect(await harness.stockOf(token, skuId)).toMatchObject({ onHand: 10, reserved: 0 });
      expect(harness.pg().refundedTxIds).toHaveLength(0);
    } finally {
      await harness.close();
    }
  });
});
