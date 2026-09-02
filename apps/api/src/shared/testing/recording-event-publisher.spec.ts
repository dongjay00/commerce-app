import { describe, expect, it } from 'vitest';
import type { DomainEvent } from '../kernel/domain-event';
import type { TransactionContext } from '../kernel/ports/transaction-manager';
import { RecordingEventPublisher } from './recording-event-publisher';

function event(type: string): DomainEvent {
  return {
    eventType: type,
    aggregateType: 'Order',
    aggregateId: '0192f3a0-1234-7abc-8def-0123456789ab',
    occurredAt: new Date('2026-01-01T00:00:00Z'),
    payload: {},
  };
}

describe('RecordingEventPublisher', () => {
  it('발행된 이벤트를 순서대로 보관한다', async () => {
    const publisher = new RecordingEventPublisher();
    await publisher.publish([event('OrderPlaced'), event('OrderPaid')]);
    expect(publisher.published.map((e) => e.eventType)).toEqual(['OrderPlaced', 'OrderPaid']);
  });

  it('여러 번 호출하면 누적된다', async () => {
    const publisher = new RecordingEventPublisher();
    await publisher.publish([event('OrderPlaced')]);
    await publisher.publish([event('OrderPaid')]);
    expect(publisher.published).toHaveLength(2);
  });

  it('타입으로 걸러낸다', async () => {
    const publisher = new RecordingEventPublisher();
    await publisher.publish([event('OrderPlaced'), event('OrderPaid'), event('OrderPlaced')]);
    expect(publisher.eventsOfType('OrderPlaced')).toHaveLength(2);
  });

  it('clear로 비운다', async () => {
    const publisher = new RecordingEventPublisher();
    await publisher.publish([event('OrderPlaced')]);
    publisher.clear();
    expect(publisher.published).toEqual([]);
  });

  it('빈 배열을 발행해도 문제없다', async () => {
    const publisher = new RecordingEventPublisher();
    await publisher.publish([]);
    expect(publisher.published).toEqual([]);
  });

  it('tx 없이 부르면 publishCalls에 undefined로 남는다', async () => {
    const publisher = new RecordingEventPublisher();
    await publisher.publish([event('OrderPlaced')]);
    expect(publisher.publishCalls).toHaveLength(1);
    expect(publisher.publishCalls[0]?.tx).toBeUndefined();
  });

  it('tx와 함께 부르면 그 값이 남는다', async () => {
    const publisher = new RecordingEventPublisher();
    const tx = {} as TransactionContext;
    await publisher.publish([event('OrderPlaced')], tx);
    expect(publisher.publishCalls[0]?.tx).toBe(tx);
  });

  it('clear()가 publishCalls도 비운다', async () => {
    const publisher = new RecordingEventPublisher();
    await publisher.publish([event('OrderPlaced')]);
    publisher.clear();
    expect(publisher.publishCalls).toEqual([]);
  });

  it('publishCalls는 인자로 받은 배열을 복사해 담는다', async () => {
    // 호출자가 배열을 재사용하면(pullEvents 뒤 재사용 등) 기록이 뒤바뀐다.
    const publisher = new RecordingEventPublisher();
    const events = [event('OrderPlaced')];
    await publisher.publish(events);
    events.length = 0;
    expect(publisher.publishCalls[0]?.events).toHaveLength(1);
  });
});
