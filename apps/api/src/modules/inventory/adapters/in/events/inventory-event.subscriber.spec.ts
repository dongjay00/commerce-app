import { describe, expect, it } from 'vitest';
import type { OutboxRecord } from '../../../../../shared/kernel/ports/event-transport';
import { InventoryEventSubscriber } from './inventory-event.subscriber';

/** 손으로 쓴 fake. 호출 이력과 던질지 여부를 통제한다. */
class FakeForOrder {
  readonly calls: string[] = [];

  constructor(
    private readonly processed = 1,
    private readonly failure: Error | null = null,
  ) {}

  async execute(command: { orderId: string }): Promise<number> {
    this.calls.push(command.orderId);
    if (this.failure !== null) {
      throw this.failure;
    }
    return this.processed;
  }
}

const ORDER = '018f2b1c-4a5d-7e6f-8a9b-0e1b00000001';

const record = (eventType: string, payload: Record<string, unknown>): OutboxRecord => ({
  id: 'outbox-1',
  aggregateType: 'Order',
  aggregateId: ORDER,
  eventType,
  payload,
  occurredAt: new Date('2026-03-01T00:00:00.000Z'),
});

function build(options: { confirmProcessed?: number; confirmFailure?: Error } = {}) {
  const confirm = new FakeForOrder(options.confirmProcessed ?? 1, options.confirmFailure ?? null);
  const release = new FakeForOrder();
  const restore = new FakeForOrder();
  return {
    subscriber: new InventoryEventSubscriber(confirm, release, restore),
    confirm,
    release,
    restore,
  };
}

describe('InventoryEventSubscriber', () => {
  it('OrderPaid면 예약을 확정한다', async () => {
    const { subscriber, confirm } = build();

    await subscriber.onOrderPaid(record('ordering.OrderPaid', { orderId: ORDER }));

    expect(confirm.calls).toEqual([ORDER]);
  });

  it('OrderPaymentFailed면 예약을 해제한다', async () => {
    const { subscriber, release } = build();

    await subscriber.onOrderPaymentFailed(
      record('ordering.OrderPaymentFailed', { orderId: ORDER }),
    );

    expect(release.calls).toEqual([ORDER]);
  });

  it('OrderCancelled에서 wasPaid가 true면 복원한다', async () => {
    // 확정된 예약은 재고가 이미 차감됐다 — "해제"가 아니라 "되돌리기"다.
    const { subscriber, restore, release } = build();

    await subscriber.onOrderCancelled(
      record('ordering.OrderCancelled', { orderId: ORDER, wasPaid: true }),
    );

    expect(restore.calls).toEqual([ORDER]);
    expect(release.calls).toEqual([]);
  });

  it('OrderCancelled에서 wasPaid가 false면 해제한다', async () => {
    const { subscriber, restore, release } = build();

    await subscriber.onOrderCancelled(
      record('ordering.OrderCancelled', { orderId: ORDER, wasPaid: false }),
    );

    expect(release.calls).toEqual([ORDER]);
    expect(restore.calls).toEqual([]);
  });

  it('payload에 orderId가 없으면 던진다', async () => {
    // 릴레이가 재시도하고 last_error에 이유가 남는다.
    const { subscriber } = build();

    await expect(subscriber.onOrderPaid(record('ordering.OrderPaid', {}))).rejects.toThrow(
      /orderId/,
    );
  });

  it('OrderCancelled에 wasPaid가 없으면 던진다', async () => {
    const { subscriber } = build();

    await expect(
      subscriber.onOrderCancelled(record('ordering.OrderCancelled', { orderId: ORDER })),
    ).rejects.toThrow(/wasPaid/);
  });

  it('처리 건수가 0이어도 던지지 않는다', async () => {
    // 중복 배달이거나 이미 처리된 주문이다. 던지면 그 이벤트가 데드레터에
    // 도달할 때까지 outbox의 head-of-line을 차지한다.
    const { subscriber } = build({ confirmProcessed: 0 });

    await expect(
      subscriber.onOrderPaid(record('ordering.OrderPaid', { orderId: ORDER })),
    ).resolves.toBeUndefined();
  });

  it('유스케이스가 던지면 그대로 전파한다', async () => {
    // 릴레이가 재시도해야 하는 진짜 실패다.
    const { subscriber } = build({ confirmFailure: new Error('DB 연결 실패') });

    await expect(
      subscriber.onOrderPaid(record('ordering.OrderPaid', { orderId: ORDER })),
    ).rejects.toThrow('DB 연결 실패');
  });
});
