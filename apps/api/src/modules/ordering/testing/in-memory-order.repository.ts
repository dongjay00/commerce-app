import type { CustomerId, OrderId } from '../../../shared/kernel/identifiers';
import type { TransactionContext } from '../../../shared/kernel/ports/transaction-manager';
import type { OrderRepository } from '../application/ports/out/order.repository';
import { Order } from '../domain/order/order';

/**
 * 단위 테스트용 OrderRepository.
 *
 * **저장·조회 시 복사한다.** 저장본을 그대로 넘기면 호출자가 나중에 그 객체를 바꿨을 때
 * 저장소가 조용히 따라 바뀐다.
 *
 * `rehydrate`로 복사하므로 **미커밋 이벤트는 복사본에 딸려가지 않는다** — 진짜
 * 리포지토리도 이벤트를 저장하지 않으므로 같은 동작이다.
 */
export class InMemoryOrderRepository implements OrderRepository {
  private readonly byId = new Map<string, Order>();

  async findById(id: OrderId, _tx?: TransactionContext): Promise<Order | null> {
    const found = this.byId.get(id);
    return found === undefined ? null : InMemoryOrderRepository.copy(found);
  }

  async listByCustomer(
    customerId: CustomerId,
    params: { limit: number; offset: number },
    _tx?: TransactionContext,
  ): Promise<Order[]> {
    return [...this.byId.values()]
      .filter((order) => order.customerId === customerId)
      .sort((left, right) => right.placedAt.getTime() - left.placedAt.getTime())
      .slice(params.offset, params.offset + params.limit)
      .map((order) => InMemoryOrderRepository.copy(order));
  }

  async save(order: Order, _tx?: TransactionContext): Promise<void> {
    this.byId.set(order.id, InMemoryOrderRepository.copy(order));
  }

  private static copy(order: Order): Order {
    return Order.rehydrate({
      id: order.id,
      customerId: order.customerId,
      status: order.status,
      lines: [...order.lines],
      shippingAddress: order.shippingAddress,
      total: order.total,
      placedAt: order.placedAt,
    });
  }
}
