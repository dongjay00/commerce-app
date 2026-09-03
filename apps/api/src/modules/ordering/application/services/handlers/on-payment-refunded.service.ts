import { OrderId } from '../../../../../shared/kernel/identifiers';
import type { Clock } from '../../../../../shared/kernel/ports/clock';
import type { TransactionManager } from '../../../../../shared/kernel/ports/transaction-manager';
import { OrderNotFoundError } from '../../../domain/order/order.errors';
import type {
  HandlePaymentRefundedCommand,
  HandlePaymentRefundedUseCase,
} from '../../ports/in/handle-payment-refunded.usecase';
import type { OrderRepository } from '../../ports/out/order.repository';

/**
 * `PaymentRefunded` 구독자(스펙 §5.6). 주문을 REFUNDED로 끝낸다.
 *
 * 이벤트를 발행하지 않는다 — `OrderRefunded`를 구독하는 곳이 없고, 구독자 없는
 * 이벤트는 outbox에 쌓이는 쓰레기다.
 */
export class OnPaymentRefundedService implements HandlePaymentRefundedUseCase {
  constructor(
    private readonly orders: OrderRepository,
    private readonly transactions: TransactionManager,
    private readonly clock: Clock,
  ) {}

  async execute(command: HandlePaymentRefundedCommand): Promise<boolean> {
    const orderId = OrderId.of(command.orderId);
    const now = this.clock.now();

    return this.transactions.run(async (tx) => {
      const order = await this.orders.findById(orderId, tx);
      if (order === null) {
        // 조용히 넘기면 정합이 깨진 사실이 영영 드러나지 않는다. 던지면 릴레이가
        // 재시도하다 데드레터로 보내고 `last_error`가 사람이 찾을 단서를 남긴다.
        throw new OrderNotFoundError(command.orderId);
      }
      const changed = order.markRefunded(now);
      if (changed) {
        await this.orders.save(order, tx);
      }
      return changed;
    });
  }
}
