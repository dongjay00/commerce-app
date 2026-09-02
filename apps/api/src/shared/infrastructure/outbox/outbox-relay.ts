import type { PrismaClient } from '@prisma/client';
import type { Clock } from '../../kernel/ports/clock';
import type { EventTransport } from '../../kernel/ports/event-transport';

/**
 * 미발행 outbox 행을 폴링해 전송하고 published_at을 채운다.
 *
 * 전달 보장은 at-least-once다. 전송 성공 후 마킹 전에 프로세스가 죽으면 같은 이벤트가
 * 다시 전송되므로 구독자는 반드시 멱등해야 한다. exactly-once는 분산 트랜잭션 없이는
 * 불가능하고, 이 프로젝트에서는 감수하는 쪽이 옳다.
 */
export class OutboxRelay {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly transport: EventTransport,
    private readonly clock: Clock,
    private readonly batchSize: number = 100,
  ) {}

  /** 한 배치를 처리하고 전송한 건수를 반환한다. */
  async relayOnce(): Promise<number> {
    const rows = await this.prisma.outbox.findMany({
      where: { publishedAt: null },
      orderBy: { occurredAt: 'asc' },
      take: this.batchSize,
    });

    let sent = 0;
    for (const row of rows) {
      await this.transport.send({
        id: row.id,
        aggregateType: row.aggregateType,
        aggregateId: row.aggregateId,
        eventType: row.eventType,
        payload: (row.payload ?? {}) as Readonly<Record<string, unknown>>,
        occurredAt: row.occurredAt,
      });

      await this.prisma.outbox.update({
        where: { id: row.id },
        data: { publishedAt: this.clock.now() },
      });
      sent += 1;
    }

    return sent;
  }
}
