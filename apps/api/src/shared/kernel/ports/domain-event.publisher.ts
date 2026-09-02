import type { DomainEvent } from '../domain-event';
import type { TransactionContext } from './transaction-manager';

/**
 * 도메인 이벤트 발행 포트.
 * tx를 함께 넘기면 애그리거트 저장과 같은 트랜잭션으로 커밋된다 — 이벤트 유실을 막는
 * 유일한 방법이다. 애플리케이션은 이 뒤에 outbox 테이블이 있다는 사실을 모른다.
 */
export interface DomainEventPublisher {
  publish(events: DomainEvent[], tx?: TransactionContext): Promise<void>;
}

export const DOMAIN_EVENT_PUBLISHER = Symbol('DomainEventPublisher');
