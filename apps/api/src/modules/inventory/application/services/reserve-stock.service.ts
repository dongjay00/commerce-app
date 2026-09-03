import type { Duration } from '../../../../shared/kernel/duration';
import { OrderId, ReservationId, SkuId } from '../../../../shared/kernel/identifiers';
import type { Clock } from '../../../../shared/kernel/ports/clock';
import type { IdGenerator } from '../../../../shared/kernel/ports/id-generator';
import type { TransactionManager } from '../../../../shared/kernel/ports/transaction-manager';
import { Quantity } from '../../../../shared/kernel/quantity';
import { Reservation } from '../../domain/reservation';
import type { ReserveStockCommand, ReserveStockUseCase } from '../ports/in/reserve-stock.usecase';
import type { ReservationRepository } from '../ports/out/reservation.repository';
import type { StockRepository } from '../ports/out/stock.repository';

export class ReserveStockService implements ReserveStockUseCase {
  constructor(
    private readonly stocks: StockRepository,
    private readonly reservations: ReservationRepository,
    private readonly transactions: TransactionManager,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly reservationTtl: Duration,
  ) {}

  async execute(command: ReserveStockCommand): Promise<{ reservationId: string; expiresAt: Date }> {
    // 값 객체 생성이 트랜잭션 밖이다 — 수량 0처럼 성공할 수 없는 요청으로 트랜잭션을
    // 열지 않는다.
    const skuId = SkuId.of(command.skuId);
    const orderId = OrderId.of(command.orderId);
    const quantity = Quantity.positive(command.quantity);
    const now = this.clock.now();

    return this.transactions.run(async (tx) => {
      // 카운터 증가와 예약 행 생성이 한 트랜잭션 안에 있다. 갈라지면 둘이 어긋나고,
      // 그 손상은 StockCounterMismatchError(500)로만 드러난다 — 편차 4가 감수하기로
      // 한 비정규화의 대가가 청구되는 지점이다.
      const reservation = await this.stocks.mutate(skuId, tx, (stock) => {
        stock.reserve(quantity); // 재고 부족이면 여기서 InsufficientStockError
        return Reservation.create({
          id: ReservationId.of(this.ids.nextId()),
          skuId,
          orderId,
          quantity,
          now,
          ttl: this.reservationTtl,
        });
      });
      await this.reservations.save(reservation, tx);
      return { reservationId: reservation.id, expiresAt: reservation.expiresAt };
    });
  }
}
