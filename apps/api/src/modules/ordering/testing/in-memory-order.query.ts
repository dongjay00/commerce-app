import type { CustomerId, OrderId } from '../../../shared/kernel/identifiers';
import type { OrderQuery, OrderSummaryView, OrderView } from '../application/ports/out/order.query';
import type { Order } from '../domain/order/order';
import type { InMemoryOrderRepository } from './in-memory-order.repository';

/**
 * 읽기 포트의 in-memory 구현. **리포지토리를 공유한다** — 따로 두면 테스트가 같은
 * 데이터를 두 번 준비해야 하고 그 둘이 서서히 어긋난다.
 */
export class InMemoryOrderQuery implements OrderQuery {
  constructor(private readonly orders: InMemoryOrderRepository) {}

  async findById(orderId: OrderId): Promise<OrderView | null> {
    const order = await this.orders.findById(orderId);
    return order === null ? null : InMemoryOrderQuery.toView(order);
  }

  async listByCustomer(
    customerId: CustomerId,
    params: { limit: number; offset: number },
  ): Promise<OrderSummaryView[]> {
    const found = await this.orders.listByCustomer(customerId, params);
    return found.map((order) => ({
      id: order.id,
      status: order.status,
      total: order.total.toDto(),
      placedAt: order.placedAt.toISOString(),
      lineCount: order.lines.length,
    }));
  }

  private static toView(order: Order): OrderView {
    return {
      id: order.id,
      customerId: order.customerId,
      status: order.status,
      total: order.total.toDto(),
      placedAt: order.placedAt.toISOString(),
      shippingAddress: {
        recipient: order.shippingAddress.recipient,
        phone: order.shippingAddress.phone,
        zip: order.shippingAddress.zip,
        line1: order.shippingAddress.line1,
        line2: order.shippingAddress.line2,
      },
      lines: order.lines.map((line) => ({
        skuId: line.skuId,
        nameSnapshot: line.nameSnapshot,
        unitPrice: line.unitPrice.toDto(),
        quantity: line.quantity.value,
        subtotal: line.subtotal.toDto(),
      })),
    };
  }
}
