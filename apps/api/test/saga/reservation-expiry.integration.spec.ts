import { describe, expect, it } from 'vitest';
import { scenario } from './saga-scenario';
import { SagaHarness } from './saga-support';

describe('사가 — 예약 TTL 만료', () => {
  it('만료되면 재고가 회복되고 주문이 PAYMENT_FAILED로 끝난다', async () => {
    // 계획 3이 재고 회복까지 증명했다. 여기서는 그 이벤트가 Ordering에 도달해
    // 주문까지 끝내는지를 본다 — 스펙 §5.6의 마지막 줄이다.
    //
    // PG를 TIMEOUT으로 두어 주문을 PENDING_PAYMENT로 남긴다. 결제가 성공하면
    // 예약이 확정되어 만료 대상이 아니다.
    const harness = await SagaHarness.boot();
    try {
      const { token, skuId } = await scenario(harness, 'saga-expiry@example.com');
      harness.pg().scenario = 'TIMEOUT';
      await harness.tryPlaceOrder(token, await harness.addAddress(token));
      const [summary] = await harness.listOrders(token);
      const orderId = summary?.id as string;
      expect(summary?.status).toBe('PENDING_PAYMENT');
      await harness.drainOutbox();

      // 타임아웃 경로는 PlaceOrderService가 예약을 이미 풀었다. TTL이 그물인 상황은
      // **보상이 돌기 전에 프로세스가 죽은** 경우이므로 그 상태를 직접 만든다.
      await harness.reserveDirectly(orderId, skuId, 3);
      expect(await harness.stockOf(token, skuId)).toMatchObject({ onHand: 10, reserved: 3 });

      // 예약을 강제로 만료시킨다. 15분을 기다릴 수는 없다.
      await harness.expireReservations(orderId);
      await harness.runExpiryScan();
      await harness.drainOutbox();

      expect((await harness.orderOf(token, orderId)).status).toBe('PAYMENT_FAILED');
      expect(await harness.stockOf(token, skuId)).toMatchObject({ onHand: 10, reserved: 0 });
    } finally {
      await harness.close();
    }
  });

  it('결제된 주문에 만료가 와도 PAID로 남는다', async () => {
    // 결제와 만료 스캔이 경합해 둘 다 이겼을 때 결제가 이긴 것이 정답이다.
    // 예약은 이미 확정됐고 재고도 차감됐다.
    const harness = await SagaHarness.boot();
    try {
      const { token, skuId } = await scenario(harness, 'saga-expiry-paid@example.com');
      const placed = await harness.placeOrder(token, await harness.addAddress(token));
      await harness.drainOutbox();

      // CONFIRMED 예약의 expires_at을 과거로 밀어도 만료 스캔은 PENDING만 찾는다.
      await harness.expireReservations(placed.orderId);
      await harness.runExpiryScan();
      await harness.drainOutbox();

      expect((await harness.orderOf(token, placed.orderId)).status).toBe('PAID');
      expect(await harness.stockOf(token, skuId)).toMatchObject({ onHand: 7, reserved: 0 });
    } finally {
      await harness.close();
    }
  });
});
