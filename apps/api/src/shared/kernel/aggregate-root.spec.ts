import { describe, expect, it } from 'vitest';
import { AggregateRoot } from './aggregate-root';
import type { DomainEvent } from './domain-event';

function sampleEvent(type: string): DomainEvent {
  return {
    eventType: type,
    aggregateType: 'Sample',
    aggregateId: '0192f3a0-1234-7abc-8def-0123456789ab',
    occurredAt: new Date('2026-01-01T00:00:00Z'),
    payload: {},
  };
}

class SampleAggregate extends AggregateRoot {
  doSomething(): void {
    this.raise(sampleEvent('SomethingHappened'));
  }

  doTwoThings(): void {
    this.raise(sampleEvent('First'));
    this.raise(sampleEvent('Second'));
  }
}

describe('AggregateRoot', () => {
  it('처음에는 미커밋 이벤트가 없다', () => {
    expect(new SampleAggregate().hasUncommittedEvents).toBe(false);
  });

  it('raise한 이벤트가 쌓인다', () => {
    const aggregate = new SampleAggregate();
    aggregate.doSomething();
    expect(aggregate.hasUncommittedEvents).toBe(true);
  });

  it('pullEvents가 쌓인 이벤트를 순서대로 반환한다', () => {
    const aggregate = new SampleAggregate();
    aggregate.doTwoThings();
    expect(aggregate.pullEvents().map((e) => e.eventType)).toEqual(['First', 'Second']);
  });

  it('pullEvents는 내부 목록을 비운다 — 같은 이벤트를 두 번 발행하지 않기 위함', () => {
    const aggregate = new SampleAggregate();
    aggregate.doSomething();
    aggregate.pullEvents();
    expect(aggregate.pullEvents()).toEqual([]);
    expect(aggregate.hasUncommittedEvents).toBe(false);
  });

  it('반환된 배열을 변형해도 애그리거트 내부에 영향이 없다', () => {
    const aggregate = new SampleAggregate();
    aggregate.doSomething();
    const pulled = aggregate.pullEvents();
    pulled.push(sampleEvent('Injected'));
    aggregate.doSomething();
    expect(aggregate.pullEvents()).toHaveLength(1);
  });
});
