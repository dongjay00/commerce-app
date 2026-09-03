import type { PrismaClient } from '@prisma/client';
import { asPrismaClient } from '../../../../../shared/infrastructure/prisma/prisma-transaction-manager';
import type { CustomerId, OrderId } from '../../../../../shared/kernel/identifiers';
import type { TransactionContext } from '../../../../../shared/kernel/ports/transaction-manager';
import type { OrderRepository } from '../../../application/ports/out/order.repository';
import type { Order } from '../../../domain/order/order';
import { toOrderDomain } from './order.mapper';

export class PrismaOrderRepository implements OrderRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: OrderId, tx?: TransactionContext): Promise<Order | null> {
    const row = await this.client(tx).order.findUnique({
      where: { id },
      include: { lines: true },
    });
    return row === null ? null : toOrderDomain(row);
  }

  async listByCustomer(
    customerId: CustomerId,
    params: { limit: number; offset: number },
    tx?: TransactionContext,
  ): Promise<Order[]> {
    const rows = await this.client(tx).order.findMany({
      where: { customerId },
      // orders_customer_placed_at_idx가 이 정렬을 지원한다(태스크 2).
      orderBy: { placedAt: 'desc' },
      take: params.limit,
      skip: params.offset,
      include: { lines: true },
    });
    return rows.map(toOrderDomain);
  }

  /**
   * 라인을 통째로 갈아끼운다.
   *
   * 주문 라인은 `place` 이후 바뀌지 않으므로 `createMany` + `skipDuplicates`로도
   * 충분하다. 그런데 장바구니와 같은 형태를 쓰는 이유: 라인이 불변이라는 것은
   * **지금의 도메인 규칙**이고, 나중에 주문 수정이 생기면 append-only 저장은 조용히
   * 틀린 결과를 낸다. 두 리포지토리가 같은 형태를 쓰면 그 규칙 변화가 저장 코드를
   * 건드리지 않는다.
   */
  async save(order: Order, tx?: TransactionContext): Promise<void> {
    const client = this.client(tx);
    const now = new Date();
    const shipping = order.shippingAddress;

    await client.order.upsert({
      where: { id: order.id },
      create: {
        id: order.id,
        customerId: order.customerId,
        status: order.status,
        totalAmount: order.total.amount,
        totalCurrency: order.total.currency,
        shipRecipient: shipping.recipient,
        shipPhone: shipping.phone,
        shipZip: shipping.zip,
        shipLine1: shipping.line1,
        shipLine2: shipping.line2,
        placedAt: order.placedAt,
        updatedAt: now,
      },
      update: { status: order.status, updatedAt: now },
    });
    await client.orderLine.deleteMany({ where: { orderId: order.id } });
    await client.orderLine.createMany({
      data: order.lines.map((line) => ({
        orderId: order.id,
        skuId: line.skuId,
        nameSnapshot: line.nameSnapshot,
        unitPriceAmount: line.unitPrice.amount,
        unitPriceCurrency: line.unitPrice.currency,
        quantity: line.quantity.value,
      })),
    });
  }

  private client(tx?: TransactionContext): PrismaClient {
    return tx ? (asPrismaClient(tx) as PrismaClient) : this.prisma;
  }
}
