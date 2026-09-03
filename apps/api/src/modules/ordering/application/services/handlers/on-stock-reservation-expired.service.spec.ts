import { describe, expect, it } from 'vitest';
import { OrderId } from '../../../../../shared/kernel/identifiers';
import { MutableClock } from '../../../../../shared/testing/mutable-clock';
import { PassthroughTransactionManager } from '../../../../../shared/testing/passthrough-transaction-manager';
import { RecordingEventPublisher } from '../../../../../shared/testing/recording-event-publisher';
import { OrderNotFoundError } from '../../../domain/order/order.errors';
import { ORDER_PAYMENT_FAILED } from '../../../domain/order/order.events';
import type { OrderStatus } from '../../../domain/order/order-status';
import { InMemoryOrderRepository } from '../../../testing/in-memory-order.repository';
import { anOrderInStatus, FIXED_NOW, orderUuid } from '../../../testing/ordering.fixtures';
import { OnStockReservationExpiredService } from './on-stock-reservation-expired.service';

const ORDER = orderUuid('1');

async function build(status: OrderStatus) {
  const orders = new InMemoryOrderRepository();
  await orders.save(anOrderInStatus(status));
  const events = new RecordingEventPublisher();
  const service = new OnStockReservationExpiredService(
    orders,
    new PassthroughTransactionManager(),
    events,
    new MutableClock(FIXED_NOW),
  );
  return { service, orders, events };
}

describe('OnStockReservationExpiredService', () => {
  it('PENDING_PAYMENT 주문을 PAYMENT_FAILED로 끝내고 이벤트를 발행한다', async () => {
    const { service, orders, events } = await build('PENDING_PAYMENT');

    expect(await service.execute({ orderId: ORDER })).toBe(true);

    expect((await orders.findById(OrderId.of(ORDER)))?.status).toBe('PAYMENT_FAILED');
    expect(events.published.map((e) => e.eventType)).toEqual([ORDER_PAYMENT_FAILED]);
    expect(events.published[0]?.payload).toMatchObject({ reason: expect.stringContaining('만료') });
  });

  it('PAID 주문에 만료가 오면 false를 돌려주고 아무것도 바꾸지 않는다', async () => {
    // 결제와 만료 스캔이 경합해 둘 다 이겼을 때 결제가 이긴 것이 정답이다.
    // failPayment를 부르면 OrderConflictError가 나고 릴레이가 영원히 재시도한다.
    const { service, orders, events } = await build('PAID');

    expect(await service.execute({ orderId: ORDER })).toBe(false);

    expect((await orders.findById(OrderId.of(ORDER)))?.status).toBe('PAID');
    expect(events.published).toHaveLength(0);
  });

  it('이미 실패한 주문에 다시 오면 false다', async () => {
    const { service, events } = await build('PAYMENT_FAILED');

    expect(await service.execute({ orderId: ORDER })).toBe(false);
    expect(events.published).toHaveLength(0);
  });

  it('취소된 주문에 만료가 와도 false다', async () => {
    const { service } = await build('CANCELLED');
    expect(await service.execute({ orderId: ORDER })).toBe(false);
  });

  it('없는 주문이면 OrderNotFoundError다', async () => {
    const { service } = await build('PENDING_PAYMENT');
    await expect(service.execute({ orderId: orderUuid('9') })).rejects.toThrow(OrderNotFoundError);
  });
});
