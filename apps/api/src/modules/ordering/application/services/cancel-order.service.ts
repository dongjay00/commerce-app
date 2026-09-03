import { CustomerId, OrderId } from '../../../../shared/kernel/identifiers';
import type { Clock } from '../../../../shared/kernel/ports/clock';
import type { DomainEventPublisher } from '../../../../shared/kernel/ports/domain-event.publisher';
import type { TransactionManager } from '../../../../shared/kernel/ports/transaction-manager';
import { OrderNotFoundError } from '../../domain/order/order.errors';
import type {
  CancelOrderCommand,
  CancelOrderResult,
  CancelOrderUseCase,
} from '../ports/in/cancel-order.usecase';
import type { OrderRepository } from '../ports/out/order.repository';

/**
 * 주문 취소. 결제 전이면 `CANCELLED`, 결제 후면 `REFUND_PENDING`(편차 1)이다.
 *
 * **소유자 검사를 여기서 하지 않는다** — `Order.cancelBy`가 도메인에서 한다(스펙 §5.5).
 * 여기서 하면 배치나 이벤트 핸들러로 들어올 때 규칙이 사라진다.
 */
export class CancelOrderService implements CancelOrderUseCase {
  constructor(
    private readonly orders: OrderRepository,
    private readonly transactions: TransactionManager,
    private readonly events: DomainEventPublisher,
    private readonly clock: Clock,
  ) {}

  async execute(command: CancelOrderCommand): Promise<CancelOrderResult> {
    const orderId = OrderId.of(command.orderId);
    const customerId = CustomerId.of(command.customerId);
    const now = this.clock.now();

    return this.transactions.run(async (tx) => {
      const order = await this.orders.findById(orderId, tx);
      if (order === null) {
        throw new OrderNotFoundError(command.orderId);
      }
      const changed = order.cancelBy(customerId, now);
      if (changed) {
        await this.orders.save(order, tx);
        await this.events.publish(order.pullEvents(), tx);
      }
      return { status: order.status };
    });
  }
}
