import type { DomainEvent } from './domain-event';

/**
 * 애그리거트 루트 기반 클래스.
 * 비즈니스 메서드가 이벤트를 raise하면 내부에 쌓이고, 리포지토리가 저장 직후
 * pullEvents()로 꺼내 같은 트랜잭션 안에서 outbox에 기록한다.
 */
export abstract class AggregateRoot {
  private uncommittedEvents: DomainEvent[] = [];

  protected raise(event: DomainEvent): void {
    this.uncommittedEvents.push(event);
  }

  /** 쌓인 이벤트를 반환하고 내부 목록을 비운다. */
  pullEvents(): DomainEvent[] {
    const pulled = this.uncommittedEvents;
    this.uncommittedEvents = [];
    return pulled;
  }

  get hasUncommittedEvents(): boolean {
    return this.uncommittedEvents.length > 0;
  }
}
