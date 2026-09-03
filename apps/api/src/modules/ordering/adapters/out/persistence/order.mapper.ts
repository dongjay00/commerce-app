import { CustomerId, OrderId, SkuId } from '../../../../../shared/kernel/identifiers';
import { type Currency, Money } from '../../../../../shared/kernel/money';
import { Quantity } from '../../../../../shared/kernel/quantity';
import { Order } from '../../../domain/order/order';
import { CorruptedOrderError } from '../../../domain/order/order.errors';
import { OrderLine } from '../../../domain/order/order-line';
import { ShippingAddress } from '../../../domain/order/shipping-address';

export interface OrderLineRow {
  skuId: string;
  nameSnapshot: string;
  unitPriceAmount: bigint;
  unitPriceCurrency: string;
  quantity: number;
}

export interface OrderRow {
  id: string;
  customerId: string;
  status: string;
  totalAmount: bigint;
  totalCurrency: string;
  shipRecipient: string;
  shipPhone: string;
  shipZip: string;
  shipLine1: string;
  shipLine2: string | null;
  placedAt: Date;
  lines: OrderLineRow[];
}

/**
 * 저장된 행 → 애그리거트. 전부 `fromPersistence`다 — 깨진 행에 400을 내면
 * 클라이언트에게 "당신의 요청이 잘못됐다"고 거짓말하는 것이다(계획 1의 M7).
 */
export function toOrderDomain(row: OrderRow): Order {
  return Order.rehydrate({
    id: OrderId.fromPersistence(row.id),
    customerId: CustomerId.fromPersistence(row.customerId),
    status: row.status,
    lines: row.lines.map((line) => toOrderLineDomain(line, row.id)),
    shippingAddress: ShippingAddress.fromPersistence({
      recipient: row.shipRecipient,
      phone: row.shipPhone,
      zip: row.shipZip,
      line1: row.shipLine1,
      line2: row.shipLine2,
    }),
    total: Money.of(row.totalAmount, asCurrency(row.totalCurrency, row.id)),
    placedAt: row.placedAt,
  });
}

function toOrderLineDomain(row: OrderLineRow, orderId: string): OrderLine {
  return OrderLine.fromPersistence({
    skuId: SkuId.fromPersistence(row.skuId),
    nameSnapshot: row.nameSnapshot,
    unitPrice: Money.of(row.unitPriceAmount, asCurrency(row.unitPriceCurrency, orderId)),
    // `positive`가 아니라 `of`다. 저장된 0은 사용자 잘못이 아니라 데이터 손상이고,
    // `positive`의 QuantityBelowMinimumError(422)는 그것을 사용자 잘못으로 만든다.
    quantity: Quantity.of(row.quantity),
  });
}

function asCurrency(value: string, orderId: string): Currency {
  if (value !== 'KRW' && value !== 'USD') {
    throw new CorruptedOrderError(orderId, `알 수 없는 통화 "${value}"`);
  }
  return value;
}
