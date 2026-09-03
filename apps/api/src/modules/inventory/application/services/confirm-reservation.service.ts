import { ReservationId } from '../../../../shared/kernel/identifiers';
import type { Clock } from '../../../../shared/kernel/ports/clock';
import type { TransactionManager } from '../../../../shared/kernel/ports/transaction-manager';
import { ReservationNotFoundError } from '../../domain/stock.errors';
import type {
  ConfirmReservationCommand,
  ConfirmReservationUseCase,
} from '../ports/in/confirm-reservation.usecase';
import type { ReservationRepository } from '../ports/out/reservation.repository';
import type { StockRepository } from '../ports/out/stock.repository';

export class ConfirmReservationService implements ConfirmReservationUseCase {
  constructor(
    private readonly stocks: StockRepository,
    private readonly reservations: ReservationRepository,
    private readonly transactions: TransactionManager,
    private readonly clock: Clock,
  ) {}

  async execute(command: ConfirmReservationCommand): Promise<void> {
    const id = ReservationId.of(command.reservationId);
    const now = this.clock.now();

    await this.transactions.run(async (tx) => {
      const reservation = await this.reservations.findById(id, tx);
      if (reservation === null) {
        throw new ReservationNotFoundError(id);
      }

      // 전이가 실제로 일어났을 때만 재고를 건드린다. 이벤트가 두 번 배달되면
      // 두 번째는 false가 돌아오고, 여기서 카운터를 또 건드리면 재고가 어긋난다.
      if (!reservation.confirm(now)) {
        return;
      }

      await this.stocks.mutate(reservation.skuId, tx, (stock) =>
        stock.confirm(reservation.quantity),
      );
      await this.reservations.save(reservation, tx);
    });
  }
}
