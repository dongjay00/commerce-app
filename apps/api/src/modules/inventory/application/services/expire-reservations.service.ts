import { Logger } from '@nestjs/common';
import type { Clock } from '../../../../shared/kernel/ports/clock';
import type { DomainEventPublisher } from '../../../../shared/kernel/ports/domain-event.publisher';
import type { TransactionManager } from '../../../../shared/kernel/ports/transaction-manager';
import type { ExpireReservationsUseCase } from '../ports/in/expire-reservations.usecase';
import type { ReservationRepository } from '../ports/out/reservation.repository';
import type { StockRepository } from '../ports/out/stock.repository';

/**
 * TTL 자가치유 (스펙 §6.2의 5단계).
 *
 * **예약 하나당 트랜잭션 하나다.** 배치 전체를 한 트랜잭션에 넣으면 (1) 한 건이
 * 실패할 때 이미 회복시킨 재고까지 되돌아가고 (2) 밀린 만료가 수만 건일 때 그
 * 트랜잭션이 끝나지 않는다. 계획 1의 `OutboxRelay`가 행 단위로 실패를 격리한 것과
 * 같은 판단이다 — "한 건의 영구 실패가 뒤의 전부를 막으면 안 된다."
 *
 * 로거는 포트가 아니다(스펙 §7.7: "로거는 불필요. Nest Logger 직접 사용").
 */
export class ExpireReservationsService implements ExpireReservationsUseCase {
  private readonly logger = new Logger(ExpireReservationsService.name);

  constructor(
    private readonly stocks: StockRepository,
    private readonly reservations: ReservationRepository,
    private readonly events: DomainEventPublisher,
    private readonly transactions: TransactionManager,
    private readonly clock: Clock,
    private readonly batchSize: number = 100,
  ) {}

  async execute(): Promise<number> {
    const now = this.clock.now();
    const expired = await this.reservations.findExpired(now, this.batchSize);

    let released = 0;
    for (const reservation of expired) {
      try {
        await this.transactions.run(async (tx) => {
          if (!reservation.expire(now)) {
            return;
          }
          await this.stocks.mutate(reservation.skuId, tx, (stock) =>
            stock.release(reservation.quantity),
          );
          await this.reservations.save(reservation, tx);
          // 같은 트랜잭션에서 outbox에 넣는다. 갈라지면 재고는 돌아왔는데
          // Ordering은 주문 실패를 모르고 영원히 PENDING_PAYMENT로 남는다(스펙 §6.3).
          await this.events.publish(reservation.pullEvents(), tx);
        });
        released += 1;
      } catch (error) {
        // 한 건의 실패가 나머지를 막지 않는다. 다음 주기가 다시 시도한다 —
        // 예약은 여전히 PENDING이고 expires_at도 그대로라 스캔에 또 걸린다.
        this.logger.error(
          `예약 만료 처리 실패 (reservationId=${reservation.id}): ${String(error)}`,
        );
      }
    }
    return released;
  }
}
