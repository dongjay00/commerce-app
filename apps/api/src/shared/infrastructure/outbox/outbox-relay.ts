import { Logger } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { Duration } from '../../kernel/duration';
import type { Clock } from '../../kernel/ports/clock';
import type { EventTransport } from '../../kernel/ports/event-transport';

/**
 * 미발행 outbox 행을 폴링해 전송하고 published_at을 채운다.
 *
 * 전달 보장은 at-least-once다. 전송 성공 후 마킹 전에 프로세스가 죽으면 같은 이벤트가
 * 다시 전송되므로 구독자는 반드시 멱등해야 한다. exactly-once는 분산 트랜잭션 없이는
 * 불가능하고, 이 프로젝트에서는 감수하는 쪽이 옳다.
 *
 * 전송은 행 단위로 격리된다: 한 행이 실패해도 예외를 삼키고 배치의 나머지 행으로
 * 계속 진행한다. 실패한 행은 attempts를 늘리고 last_error를 남긴 뒤 지수 백오프로
 * next_attempt_at을 미뤄, 그 시각이 지날 때까지 다시 선택되지 않는다. attempts가
 * MAX_ATTEMPTS에 도달하면 더 이상 선택되지 않는 데드레터 상태로 테이블에 남고,
 * last_error가 사람이 원인을 찾을 단서가 된다. 이 격리가 없으면 영구히 실패하는
 * 이벤트 하나가 occurred_at 오름차순 정렬 때문에 매 폴링마다 맨 앞에서 재선택되어
 * 뒤의 모든 이벤트를 영원히 막는다(head-of-line blocking).
 */
export class OutboxRelay {
  /**
   * 이 횟수만큼 실패하면 더 이상 선택하지 않는다 — 데드레터.
   *
   * n번 실패하는 동안 적용되는 백오프 지연은 n-1번뿐이다: attempts가
   * MAX_ATTEMPTS에 도달한 실패는 그 즉시 데드레터되어 next_attempt_at을
   * 기다릴 필요가 없기 때문이다. MAX_ATTEMPTS=10이면 attempts=1..9에 대해
   * backoff()가 2, 4, 8, 16, 32, 60, 60, 60, 60초를 반환하고 그 합은 302초
   * (≈5분)로, 15분 예약 TTL 안에 보상 릴리스가 돌 여유를 남기면서 60초 캡도
   * attempts>=6에서 실제로 도달한다.
   */
  private static readonly MAX_ATTEMPTS = 10;

  private readonly logger = new Logger(OutboxRelay.name);

  constructor(
    private readonly prisma: PrismaClient,
    private readonly transport: EventTransport,
    private readonly clock: Clock,
    private readonly batchSize: number = 100,
  ) {}

  /** 한 배치를 처리하고 전송한 건수를 반환한다. */
  async relayOnce(): Promise<number> {
    const now = this.clock.now();
    const rows = await this.prisma.outbox.findMany({
      where: {
        publishedAt: null,
        attempts: { lt: OutboxRelay.MAX_ATTEMPTS },
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
      },
      orderBy: { occurredAt: 'asc' },
      take: this.batchSize,
    });

    let sent = 0;
    for (const row of rows) {
      try {
        await this.transport.send({
          id: row.id,
          aggregateType: row.aggregateType,
          aggregateId: row.aggregateId,
          eventType: row.eventType,
          payload: (row.payload ?? {}) as Readonly<Record<string, unknown>>,
          occurredAt: row.occurredAt,
        });
      } catch (error) {
        const attempts = row.attempts + 1;
        if (attempts >= OutboxRelay.MAX_ATTEMPTS) {
          // DB가 이 update 자체를 실패시킬 수도 있으니, 신호가 그 실패보다
          // 먼저 남도록 로그를 update 앞에 둔다.
          this.logger.error(
            `outbox 이벤트가 재시도 한도를 넘겨 데드레터됩니다: id=${row.id}, eventType=${row.eventType}, aggregateId=${row.aggregateId}`,
          );
        }
        await this.prisma.outbox.update({
          where: { id: row.id },
          data: {
            attempts,
            lastError: String(error),
            nextAttemptAt: new Date(this.clock.now().getTime() + this.backoff(attempts).millis),
          },
        });
        continue;
      }

      // send()가 성공한 뒤 이 update가 실패하면 전송은 이미 끝난 상태다 — 그걸
      // "전송 실패"로 기록해 attempts를 늘리고 transport를 탓하는 건 부정확하다.
      // try 밖에 두어 이 실패가 배치를 중단하게 둔다 — "DB에 쓸 수 없다"는
      // 사실을 있는 그대로 드러내는 쪽이 정직한 실패다.
      await this.prisma.outbox.update({
        where: { id: row.id },
        data: { publishedAt: this.clock.now() },
      });
      sent += 1;
    }

    return sent;
  }

  /** 지수 백오프: 2^attempts초, 최대 60초로 캡. */
  private backoff(attempts: number): Duration {
    return Duration.seconds(Math.min(2 ** attempts, 60));
  }
}
