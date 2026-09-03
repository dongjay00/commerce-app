import type { DomainEvent } from '../../../shared/kernel/domain-event';
import type { OrderId, ReservationId, SkuId } from '../../../shared/kernel/identifiers';
import type { Quantity } from '../../../shared/kernel/quantity';

export const STOCK_RESERVATION_EXPIRED = 'inventory.StockReservationExpired';

/**
 * 예약이 TTL로 만료됐다. 계획 4의 Ordering이 구독해 주문을 실패 처리한다.
 *
 * payload에는 **JSON 직렬화 가능한 원시 값만** 담는다 — outbox의 payload 컬럼이
 * JsonB이고, 값 객체를 그대로 넣으면 직렬화가 `{}`가 되어 조용히 빈 이벤트가 발행된다.
 */
export function stockReservationExpired(
  reservation: {
    readonly id: ReservationId;
    readonly skuId: SkuId;
    readonly orderId: OrderId;
    readonly quantity: Quantity;
  },
  occurredAt: Date,
): DomainEvent {
  return {
    eventType: STOCK_RESERVATION_EXPIRED,
    aggregateType: 'Reservation',
    aggregateId: reservation.id,
    occurredAt,
    payload: {
      reservationId: reservation.id,
      skuId: reservation.skuId,
      orderId: reservation.orderId,
      quantity: reservation.quantity.value,
    },
  };
}
