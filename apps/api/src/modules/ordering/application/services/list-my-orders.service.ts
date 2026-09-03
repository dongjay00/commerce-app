import { CustomerId } from '../../../../shared/kernel/identifiers';
import type { ListMyOrdersQuery } from '../ports/in/queries/list-my-orders.query';
import type { OrderQuery, OrderSummaryView } from '../ports/out/order.query';

/** 상한이 없으면 한 요청이 고객의 전체 주문 이력을 훑는다. */
const MAX_LIMIT = 100;

export class ListMyOrdersService implements ListMyOrdersQuery {
  constructor(private readonly orders: OrderQuery) {}

  async execute(command: {
    customerId: string;
    limit: number;
    offset: number;
  }): Promise<OrderSummaryView[]> {
    return this.orders.listByCustomer(CustomerId.of(command.customerId), {
      limit: Math.min(command.limit, MAX_LIMIT),
      offset: command.offset,
    });
  }
}
