import type { Prisma, PrismaClient } from '@prisma/client';
import type { DomainEvent } from '../../kernel/domain-event';
import type { DomainEventPublisher } from '../../kernel/ports/domain-event.publisher';
import type { IdGenerator } from '../../kernel/ports/id-generator';
import type { TransactionContext } from '../../kernel/ports/transaction-manager';
import { asPrismaClient } from '../prisma/prisma-transaction-manager';

/**
 * 도메인 이벤트를 outbox 테이블에 기록하는 어댑터.
 * tx가 주어지면 그 트랜잭션 클라이언트로 INSERT하므로 애그리거트 저장과 원자적으로 커밋된다.
 * 실제 발행은 OutboxRelay가 별도로 수행한다.
 */
export class OutboxEventPublisher implements DomainEventPublisher {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly ids: IdGenerator,
  ) {}

  async publish(events: DomainEvent[], tx?: TransactionContext): Promise<void> {
    if (events.length === 0) return;

    const client = tx ? asPrismaClient(tx) : this.prisma;
    await client.outbox.createMany({
      data: events.map((event) => ({
        id: this.ids.nextId(),
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        eventType: event.eventType,
        payload: event.payload as Prisma.InputJsonValue,
        occurredAt: event.occurredAt,
      })),
    });
  }
}
