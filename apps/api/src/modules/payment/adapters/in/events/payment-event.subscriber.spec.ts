import { describe, expect, it } from 'vitest';
import type { OutboxRecord } from '../../../../../shared/kernel/ports/event-transport';
import { orderUuid } from '../../../testing/payment.fixtures';
import { PaymentEventSubscriber } from './payment-event.subscriber';

class FakeRefund {
  readonly calls: string[] = [];

  constructor(
    private readonly refunded = true,
    private readonly failure: Error | null = null,
  ) {}

  async execute(command: { orderId: string }): Promise<boolean> {
    this.calls.push(command.orderId);
    if (this.failure !== null) {
      throw this.failure;
    }
    return this.refunded;
  }
}

const ORDER = orderUuid('1');

const cancelled = (payload: Record<string, unknown>): OutboxRecord => ({
  id: 'outbox-1',
  aggregateType: 'Order',
  aggregateId: ORDER,
  eventType: 'ordering.OrderCancelled',
  payload,
  occurredAt: new Date('2026-03-01T00:00:00.000Z'),
});

describe('PaymentEventSubscriber', () => {
  it('wasPaid가 true면 환불한다', async () => {
    const refund = new FakeRefund();

    await new PaymentEventSubscriber(refund).onOrderCancelled(
      cancelled({ orderId: ORDER, wasPaid: true }),
    );

    expect(refund.calls).toEqual([ORDER]);
  });

  it('wasPaid가 false면 환불하지 않는다', async () => {
    // 결제 전 취소는 돈이 오간 적이 없다. 시도하면 PaymentNotFoundError가 나고
    // 릴레이가 영원히 재시도한다.
    const refund = new FakeRefund();

    await new PaymentEventSubscriber(refund).onOrderCancelled(
      cancelled({ orderId: ORDER, wasPaid: false }),
    );

    expect(refund.calls).toEqual([]);
  });

  it('이미 환불된 결제여도 던지지 않는다', async () => {
    // 같은 이벤트가 두 번 배달돼도 Payment.refund가 false를 돌려준다.
    const refund = new FakeRefund(false);

    await expect(
      new PaymentEventSubscriber(refund).onOrderCancelled(
        cancelled({ orderId: ORDER, wasPaid: true }),
      ),
    ).resolves.toBeUndefined();
  });

  it('wasPaid가 없으면 던진다', async () => {
    await expect(
      new PaymentEventSubscriber(new FakeRefund()).onOrderCancelled(cancelled({ orderId: ORDER })),
    ).rejects.toThrow(/wasPaid/);
  });

  it('환불이 던지면 그대로 전파한다', async () => {
    const refund = new FakeRefund(true, new Error('PG 오류'));

    await expect(
      new PaymentEventSubscriber(refund).onOrderCancelled(
        cancelled({ orderId: ORDER, wasPaid: true }),
      ),
    ).rejects.toThrow('PG 오류');
  });
});
