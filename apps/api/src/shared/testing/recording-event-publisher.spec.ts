import { describe, expect, it } from 'vitest';
import type { DomainEvent } from '../kernel/domain-event';
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
});
