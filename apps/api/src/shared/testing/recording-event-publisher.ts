import type { DomainEvent } from '../kernel/domain-event';
import type { DomainEventPublisher } from '../kernel/ports/domain-event.publisher';
import type { TransactionContext } from '../kernel/ports/transaction-manager';

export interface PublishCall {
  readonly events: DomainEvent[];
  readonly tx: TransactionContext | undefined;
}

/**
 * 유스케이스 테스트용 fake.
 * "이 유스케이스가 OrderPaid를 발행했는가"를 상태로 검증한다.
 *
 * `publishCalls`는 호출 단위로 `tx`까지 남긴다 — 이벤트를 애그리거트 저장과 같은
 * 트랜잭션에서 발행했는지 확인하려면 그 인자가 있었는지를 봐야 한다. `tx`를 빠뜨리면
 * 애그리거트는 커밋되고 이벤트만 유실되는 경로가 열리는데, `published`만 보는
 * 테스트로는 그 회귀를 잡을 수 없다.
 */
export class RecordingEventPublisher implements DomainEventPublisher {
  readonly published: DomainEvent[] = [];
  readonly publishCalls: PublishCall[] = [];

  async publish(events: DomainEvent[], tx?: TransactionContext): Promise<void> {
    this.published.push(...events);
    this.publishCalls.push({ events: [...events], tx });
  }

  eventsOfType(eventType: string): DomainEvent[] {
    return this.published.filter((event) => event.eventType === eventType);
  }

  clear(): void {
    this.published.length = 0;
    this.publishCalls.length = 0;
  }
}
