import type { PrismaClient } from '@prisma/client';
import type { CustomerId, OrderId } from '../../../../../shared/kernel/identifiers';
import type {
  OrderQuery,
  OrderSummaryView,
  OrderView,
} from '../../../application/ports/out/order.query';

/**
 * **애그리거트를 만들지 않는다** (스펙 §7.2). Prisma가 직접 projection해 뷰를 만든다.
 *
 * 손상 검사도 하지 않는다 — 조회는 상태를 바꾸지 않으므로 불변식을 지킬 이유가 없고,
 * 손상된 행을 화면에 보여주는 것이 조회 전체를 500으로 막는 것보다 낫다. 쓰기 경로
 * (`PrismaOrderRepository`)가 `Order.rehydrate`로 그 검사를 한다.
 */
export class PrismaOrderQuery implements OrderQuery {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(orderId: OrderId): Promise<OrderView | null> {
    const row = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { lines: true },
    });
    if (row === null) {
      return null;
    }
    return {
      id: row.id,
      customerId: row.customerId,
      status: row.status,
      total: { amount: row.totalAmount.toString(), currency: row.totalCurrency },
      placedAt: row.placedAt.toISOString(),
      shippingAddress: {
        recipient: row.shipRecipient,
        phone: row.shipPhone,
        zip: row.shipZip,
        line1: row.shipLine1,
        line2: row.shipLine2,
      },
      lines: row.lines.map((line) => ({
        skuId: line.skuId,
        nameSnapshot: line.nameSnapshot,
        unitPrice: {
          amount: line.unitPriceAmount.toString(),
          currency: line.unitPriceCurrency,
        },
        quantity: line.quantity,
        subtotal: {
          amount: (line.unitPriceAmount * BigInt(line.quantity)).toString(),
          currency: line.unitPriceCurrency,
        },
      })),
    };
  }

  async listByCustomer(
    customerId: CustomerId,
    params: { limit: number; offset: number },
  ): Promise<OrderSummaryView[]> {
    const rows = await this.prisma.order.findMany({
      where: { customerId },
      orderBy: { placedAt: 'desc' },
      take: params.limit,
      skip: params.offset,
      // 목록에 라인 전체를 실으면 20건 조회에 200줄이 딸려온다. 개수만 센다.
      select: {
        id: true,
        status: true,
        totalAmount: true,
        totalCurrency: true,
        placedAt: true,
        _count: { select: { lines: true } },
      },
    });
    return rows.map((row) => ({
      id: row.id,
      status: row.status,
      total: { amount: row.totalAmount.toString(), currency: row.totalCurrency },
      placedAt: row.placedAt.toISOString(),
      lineCount: row._count.lines,
    }));
  }
}
