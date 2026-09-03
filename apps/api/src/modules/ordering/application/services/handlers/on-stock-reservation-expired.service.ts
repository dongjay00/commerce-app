import { OrderId } from '../../../../../shared/kernel/identifiers';
import type { Clock } from '../../../../../shared/kernel/ports/clock';
import type { DomainEventPublisher } from '../../../../../shared/kernel/ports/domain-event.publisher';
import type { TransactionManager } from '../../../../../shared/kernel/ports/transaction-manager';
import { OrderNotFoundError } from '../../../domain/order/order.errors';
import type {
  HandleStockReservationExpiredCommand,
  HandleStockReservationExpiredUseCase,
} from '../../ports/in/handle-stock-reservation-expired.usecase';
import type { OrderRepository } from '../../ports/out/order.repository';

/** 만료로 인한 실패 사유. 사용자에게 그대로 보인다. */
const EXPIRY_REASON = '결제 시간이 초과되어 예약이 만료되었습니다.';

/**
 * `StockReservationExpired` 구독자(스펙 §5.6). 계획 3이 이 이벤트를 발행했지만
 * 구독자가 없었다 — 여기서 그 고리가 닫힌다.
 *
 * **`PAID` 주문에는 아무것도 하지 않는다.** 결제 성공과 만료 스캔이 경합해 둘 다
 * 이겼을 수 있고, 그때는 결제가 이긴 것이 정답이다 — 예약은 이미 확정됐고 재고도
 * 차감됐다. `failPayment`를 부르면 `OrderConflictError`가 나고 릴레이가 그 이벤트를
 * 영원히 재시도한다.
 */
export class OnStockReservationExpiredService implements HandleStockReservationExpiredUseCase {
  constructor(
    private readonly orders: OrderRepository,
    private readonly transactions: TransactionManager,
    private readonly events: DomainEventPublisher,
    private readonly clock: Clock,
  ) {}

  async execute(command: HandleStockReservationExpiredCommand): Promise<boolean> {
    const orderId = OrderId.of(command.orderId);
    const now = this.clock.now();

    return this.transactions.run(async (tx) => {
      const order = await this.orders.findById(orderId, tx);
      if (order === null) {
        throw new OrderNotFoundError(command.orderId);
      }
      if (order.status !== 'PENDING_PAYMENT') {
        // 이미 결말이 났다. PAID면 결제가 경합에서 이긴 것이고, 그 외면 이미
        // 실패·취소된 주문이다. 어느 쪽이든 만료가 할 일은 없다.
        return false;
      }
      const changed = order.failPayment(EXPIRY_REASON, now);
      if (changed) {
        await this.orders.save(order, tx);
        await this.events.publish(order.pullEvents(), tx);
      }
      return changed;
    });
  }
}
