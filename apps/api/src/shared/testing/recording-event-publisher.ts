import type { DomainEvent } from '../kernel/domain-event';
import type { DomainEventPublisher } from '../kernel/ports/domain-event.publisher';

/**
 * 유스케이스 테스트용 fake.
 * "이 유스케이스가 OrderPaid를 발행했는가"를 상태로 검증한다.
 */
export class RecordingEventPublisher implements DomainEventPublisher {
  readonly published: DomainEvent[] = [];

  async publish(events: DomainEvent[]): Promise<void> {
    this.published.push(...events);
  }

  eventsOfType(eventType: string): DomainEvent[] {
    return this.published.filter((event) => event.eventType === eventType);
  }

  clear(): void {
    this.published.length = 0;
  }
}
