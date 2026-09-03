import { describe, expect, it } from 'vitest';
import { OrderId } from '../../../../shared/kernel/identifiers';
import { MutableClock } from '../../../../shared/testing/mutable-clock';
import { PassthroughTransactionManager } from '../../../../shared/testing/passthrough-transaction-manager';
import { RecordingEventPublisher } from '../../../../shared/testing/recording-event-publisher';
import {
  OrderConflictError,
  OrderNotFoundError,
  OrderNotOwnedError,
} from '../../domain/order/order.errors';
import { ORDER_CANCELLED } from '../../domain/order/order.events';
import type { OrderStatus } from '../../domain/order/order-status';
import { InMemoryOrderRepository } from '../../testing/in-memory-order.repository';
import {
  anOrderInStatus,
  customerUuid,
  FIXED_NOW,
  orderUuid,
} from '../../testing/ordering.fixtures';
import { CancelOrderService } from './cancel-order.service';

const OWNER = customerUuid('1');
const STRANGER = customerUuid('2');
const ORDER = orderUuid('1');

async function build(status: OrderStatus) {
  const orders = new InMemoryOrderRepository();
  await orders.save(anOrderInStatus(status));
  const events = new RecordingEventPublisher();
  const service = new CancelOrderService(
    orders,
    new PassthroughTransactionManager(),
    events,
    new MutableClock(FIXED_NOW),
  );
  return { service, orders, events };
}

const cancel = (service: CancelOrderService, customerId = OWNER) =>
  service.execute({ orderId: ORDER, customerId });

describe('CancelOrderService', () => {
  it('결제 전 주문은 CANCELLED가 되고 wasPaid가 false다', async () => {
    const { service, events } = await build('PENDING_PAYMENT');

    expect((await cancel(service)).status).toBe('CANCELLED');

    expect(events.published.map((e) => e.eventType)).toEqual([ORDER_CANCELLED]);
    expect(events.published[0]?.payload).toMatchObject({ wasPaid: false });
  });

  it('결제 후 주문은 REFUND_PENDING이 되고 wasPaid가 true다', async () => {
    // 편차 1. 환불이 끝날 때까지 PAID로 두면 고객에게 거짓말을 한다.
    const { service, events } = await build('PAID');

    expect((await cancel(service)).status).toBe('REFUND_PENDING');

    expect(events.published[0]?.payload).toMatchObject({ wasPaid: true });
  });

  it('두 번 취소하면 이벤트가 한 번만 나간다', async () => {
    // 여기서 막지 못하면 환불이 두 번 요청된다.
    const { service, events } = await build('PAID');
    await cancel(service);
    await cancel(service);

    expect(events.published).toHaveLength(1);
  });

  it('두 번째 취소도 현재 상태를 돌려준다', async () => {
    // 클라이언트가 "이미 취소됨"을 그릴 수 있어야 한다.
    const { service } = await build('PAID');
    await cancel(service);

    expect((await cancel(service)).status).toBe('REFUND_PENDING');
  });

  it('남의 주문은 OrderNotOwnedError다', async () => {
    const { service } = await build('PAID');
    await expect(cancel(service, STRANGER)).rejects.toThrow(OrderNotOwnedError);
  });

  it('남의 주문 취소는 이벤트를 남기지 않고 상태도 바꾸지 않는다', async () => {
    const { service, events, orders } = await build('PAID');
    await cancel(service, STRANGER).catch(() => undefined);

    expect(events.published).toHaveLength(0);
    expect((await orders.findById(OrderId.of(ORDER)))?.status).toBe('PAID');
  });

  it('결제 실패한 주문은 취소할 수 없다', async () => {
    const { service } = await build('PAYMENT_FAILED');
    await expect(cancel(service)).rejects.toThrow(OrderConflictError);
  });

  it('없는 주문은 OrderNotFoundError다', async () => {
    const { service } = await build('PENDING_PAYMENT');
    await expect(service.execute({ orderId: orderUuid('9'), customerId: OWNER })).rejects.toThrow(
      OrderNotFoundError,
    );
  });
});
