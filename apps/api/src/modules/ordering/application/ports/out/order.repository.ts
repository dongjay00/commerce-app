import type { CustomerId, OrderId } from '../../../../../shared/kernel/identifiers';
import type { TransactionContext } from '../../../../../shared/kernel/ports/transaction-manager';
import type { Order } from '../../../domain/order/order';

export interface OrderRepository {
  findById(id: OrderId, tx?: TransactionContext): Promise<Order | null>;
  /**
   * 최신 주문부터. `orders_customer_placed_at_idx`가 이 정렬을 지원한다(태스크 2).
   *
   * 읽기 포트 `OrderQuery.listByCustomer`와 이름을 맞춘다 — 돌려주는 것은 다르지만
   * (애그리거트 대 요약 뷰) 같은 질문에 답하므로 이름이 갈리면 호출부에서 헷갈린다.
   */
  listByCustomer(
    customerId: CustomerId,
    params: { limit: number; offset: number },
    tx?: TransactionContext,
  ): Promise<Order[]>;
  save(order: Order, tx?: TransactionContext): Promise<void>;
}

export const ORDER_REPOSITORY = Symbol('OrderRepository');
