import type { OrderView } from '../../out/order.query';

export interface GetOrderQuery {
  execute(params: { orderId: string; customerId: string }): Promise<OrderView>;
}

export const GET_ORDER_QUERY = Symbol('GetOrderQuery');
