import { Logger } from '@nestjs/common';
import { OrderId } from '../../../../shared/kernel/identifiers';
import type { Clock } from '../../../../shared/kernel/ports/clock';
import type { TransactionManager } from '../../../../shared/kernel/ports/transaction-manager';
import type { Quantity } from '../../../../shared/kernel/quantity';
import type { Reservation } from '../../domain/reservation';
import type { StockItem } from '../../domain/stock-item';
import type { ReservationRepository } from '../ports/out/reservation.repository';
import type { StockRepository } from '../ports/out/stock.repository';

/**
 * 주문 하나의 예약을 한꺼번에 처리한다. 셋 다 같은 골격이다 — 주문의 예약을 찾고,
 * 각각에 전이를 시도하고, 성공한 것에 대해 재고를 움직인다.
 *
 * **예약마다 트랜잭션을 연다.** 한 주문의 예약이 여러 SKU에 걸쳐 있고, 하나가
 * 실패해도 나머지는 처리돼야 한다 — 계획 3의 `ExpireReservationsService`가 같은
 * 판단을 했다. 전부 한 트랜잭션에 넣으면 SKU 하나의 잠금 경합이 주문 전체를 막는다.
 *
 * **처리 건수를 돌려준다.** 0이면 이미 전부 처리됐다는 뜻이고, 구독 어댑터가 그것을
 * 로그로 남겨 중복 배달을 관측할 수 있게 한다.
 *
 * 메서드 이름이 셋 다 `execute`일 수는 없으므로 `confirm`/`release`/`restore`로
 * 노출하고 모듈이 얇은 객체 리터럴로 감싼다.
 */
export class ReservationsForOrderService {
  private readonly logger = new Logger(ReservationsForOrderService.name);

  constructor(
    private readonly stocks: StockRepository,
    private readonly reservations: ReservationRepository,
    private readonly transactions: TransactionManager,
    private readonly clock: Clock,
  ) {}

  async confirm(command: { orderId: string }): Promise<number> {
    return this.applyEach(
      command.orderId,
      (reservation, now) => reservation.confirm(now),
      (stock, quantity) => stock.confirm(quantity),
    );
  }

  async release(command: { orderId: string }): Promise<number> {
    return this.applyEach(
      command.orderId,
      (reservation, now) => reservation.release(now),
      (stock, quantity) => stock.release(quantity),
    );
  }

  async restore(command: { orderId: string }): Promise<number> {
    return this.applyEach(
      command.orderId,
      (reservation, now) => reservation.restore(now),
      (stock, quantity) => stock.restore(quantity),
    );
  }

  private async applyEach(
    rawOrderId: string,
    transition: (reservation: Reservation, now: Date) => boolean,
    apply: (stock: StockItem, quantity: Quantity) => void,
  ): Promise<number> {
    const orderId = OrderId.of(rawOrderId);
    const now = this.clock.now();
    const found = await this.reservations.findByOrderId(orderId);

    let processed = 0;
    for (const reservation of found) {
      try {
        const changed = await this.transactions.run(async (tx) => {
          // 트랜잭션 안에서 다시 읽는다. 밖에서 읽은 것은 다른 요청이 이미
          // 바꿨을 수 있고, 그 위에 전이를 얹으면 잃어버린 갱신이 된다.
          const fresh = await this.reservations.findById(reservation.id, tx);
          if (fresh === null || !transition(fresh, now)) {
            return false;
          }
          await this.stocks.mutate(fresh.skuId, tx, (stock) => {
            apply(stock, fresh.quantity);
          });
          await this.reservations.save(fresh, tx);
          return true;
        });
        if (changed) {
          processed += 1;
        }
      } catch (error) {
        // 한 예약의 실패가 나머지를 막지 않는다. 실패한 것은 TTL이 회수하거나
        // (PENDING이면) 운영자가 last_error를 보고 처리한다.
        this.logger.error(
          `주문 ${rawOrderId}의 예약 ${reservation.id} 처리 실패: ${String(error)}`,
        );
      }
    }
    return processed;
  }
}
