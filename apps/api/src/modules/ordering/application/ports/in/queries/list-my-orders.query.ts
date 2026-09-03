import type { OrderSummaryView } from '../../out/order.query';

export interface ListMyOrdersQuery {
  execute(params: {
    customerId: string;
    limit: number;
    offset: number;
  }): Promise<OrderSummaryView[]>;
}

export const LIST_MY_ORDERS_QUERY = Symbol('ListMyOrdersQuery');
