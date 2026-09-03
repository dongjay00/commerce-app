import { describe, expect, it } from 'vitest';
import type { OutboxRecord } from '../../../../../shared/kernel/ports/event-transport';
import { orderUuid } from '../../../testing/ordering.fixtures';
import { OrderingEventSubscriber } from './ordering-event.subscriber';

class FakeHandler {
  readonly calls: string[] = [];

  constructor(
    private readonly changed = true,
    private readonly failure: Error | null = null,
  ) {}

  async execute(command: { orderId: string }): Promise<boolean> {
    this.calls.push(command.orderId);
    if (this.failure !== null) {
      throw this.failure;
    }
    return this.changed;
  }
}

const ORDER = orderUuid('1');

const record = (eventType: string, payload: Record<string, unknown>): OutboxRecord => ({
  id: 'outbox-1',
  aggregateType: 'Payment',
  aggregateId: 'x',
  eventType,
  payload,
  occurredAt: new Date('2026-03-01T00:00:00.000Z'),
});

function build(options: { changed?: boolean; failure?: Error } = {}) {
  const refunded = new FakeHandler(options.changed ?? true, options.failure ?? null);
  const expired = new FakeHandler(options.changed ?? true, options.failure ?? null);
  return { subscriber: new OrderingEventSubscriber(refunded, expired), refunded, expired };
}

describe('OrderingEventSubscriber', () => {
  it('PaymentRefunded면 환불 완료를 처리한다', async () => {
    const { subscriber, refunded } = build();

    await subscriber.onPaymentRefunded(
      record('payment.PaymentRefunded', { orderId: ORDER, paymentId: 'p1' }),
    );

    expect(refunded.calls).toEqual([ORDER]);
  });

  it('StockReservationExpired면 만료를 처리한다', async () => {
    const { subscriber, expired } = build();

    await subscriber.onStockReservationExpired(
      record('inventory.StockReservationExpired', { orderId: ORDER, reservationId: 'r1' }),
    );

    expect(expired.calls).toEqual([ORDER]);
  });

  it('payload에 orderId가 없으면 던진다', async () => {
    const { subscriber } = build();

    await expect(
      subscriber.onPaymentRefunded(record('payment.PaymentRefunded', { paymentId: 'p1' })),
    ).rejects.toThrow(/orderId/);
  });

  it('이미 처리된 주문이어도 던지지 않는다', async () => {
    const { subscriber } = build({ changed: false });

    await expect(
      subscriber.onPaymentRefunded(record('payment.PaymentRefunded', { orderId: ORDER })),
    ).resolves.toBeUndefined();
  });

  it('유스케이스가 던지면 그대로 전파한다', async () => {
    const { subscriber } = build({ failure: new Error('주문을 찾을 수 없습니다') });

    await expect(
      subscriber.onStockReservationExpired(
        record('inventory.StockReservationExpired', { orderId: ORDER }),
      ),
    ).rejects.toThrow('주문을 찾을 수 없습니다');
  });
});
