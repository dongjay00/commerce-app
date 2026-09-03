import { describe, expect, it } from 'vitest';
import { OrderId } from '../../../../../shared/kernel/identifiers';
import { MutableClock } from '../../../../../shared/testing/mutable-clock';
import { PassthroughTransactionManager } from '../../../../../shared/testing/passthrough-transaction-manager';
import { OrderConflictError, OrderNotFoundError } from '../../../domain/order/order.errors';
import type { OrderStatus } from '../../../domain/order/order-status';
import { InMemoryOrderRepository } from '../../../testing/in-memory-order.repository';
import { anOrderInStatus, FIXED_NOW, orderUuid } from '../../../testing/ordering.fixtures';
import { OnPaymentRefundedService } from './on-payment-refunded.service';

const ORDER = orderUuid('1');

async function build(status: OrderStatus) {
  const orders = new InMemoryOrderRepository();
  await orders.save(anOrderInStatus(status));
  const service = new OnPaymentRefundedService(
    orders,
    new PassthroughTransactionManager(),
    new MutableClock(FIXED_NOW),
  );
  return { service, orders };
}

describe('OnPaymentRefundedService', () => {
  it('REFUND_PENDING 주문을 REFUNDED로 만든다', async () => {
    const { service, orders } = await build('REFUND_PENDING');

    expect(await service.execute({ orderId: ORDER })).toBe(true);

    expect((await orders.findById(OrderId.of(ORDER)))?.status).toBe('REFUNDED');
  });

  it('두 번 오면 두 번째는 false다', async () => {
    // PaymentRefunded도 outbox를 거쳐 at-least-once로 배달된다(스펙 §6.3).
    const { service } = await build('REFUND_PENDING');
    await service.execute({ orderId: ORDER });

    expect(await service.execute({ orderId: ORDER })).toBe(false);
  });

  it('없는 주문이면 OrderNotFoundError다', async () => {
    // 조용히 넘기면 정합이 깨진 사실이 영영 드러나지 않는다. 던지면 릴레이가
    // 재시도하다 데드레터로 보내고 last_error가 사람이 찾을 단서를 남긴다.
    const { service } = await build('REFUND_PENDING');
    await expect(service.execute({ orderId: orderUuid('9') })).rejects.toThrow(OrderNotFoundError);
  });

  it('PAID 상태에 환불 완료가 오면 OrderConflictError다', async () => {
    // 취소 요청 없이 환불이 왔다는 것은 사가가 순서를 잃었다는 뜻이다.
    const { service } = await build('PAID');
    await expect(service.execute({ orderId: ORDER })).rejects.toThrow(OrderConflictError);
  });
});
