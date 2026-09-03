import type { DomainEvent } from '../../../../shared/kernel/domain-event';
import type { CustomerId, OrderId } from '../../../../shared/kernel/identifiers';
import type { Money } from '../../../../shared/kernel/money';

export const ORDER_PLACED = 'ordering.OrderPlaced';
export const ORDER_PAID = 'ordering.OrderPaid';
export const ORDER_PAYMENT_FAILED = 'ordering.OrderPaymentFailed';
export const ORDER_CANCELLED = 'ordering.OrderCancelled';

interface OrderSnapshot {
  readonly id: OrderId;
  readonly customerId: CustomerId;
  readonly total: Money;
}

/**
 * payload에는 **JSON 직렬화 가능한 원시 값만** 담는다 — outbox의 payload가 JsonB이고
 * 값 객체를 그대로 넣으면 `{}`로 직렬화되어 조용히 빈 이벤트가 나간다. `bigint`도
 * 직렬화되지 않으므로 금액은 문자열이다.
 *
 * **예약 ID를 담지 않는다.** 담으려면 `Order`가 Inventory의 내부 식별자를 들어야 하고,
 * 그것은 Core 애그리거트에 다른 컨텍스트를 박는 결합이다. Inventory는 `orderId`로
 * 자기 예약을 찾는다(태스크 17) — `reservations.order_id`에 인덱스가 이미 있다.
 */
function base(order: OrderSnapshot, eventType: string, occurredAt: Date): DomainEvent {
  return {
    eventType,
    aggregateType: 'Order',
    aggregateId: order.id,
    occurredAt,
    payload: {
      orderId: order.id,
      customerId: order.customerId,
      totalAmount: order.total.amount.toString(),
      totalCurrency: order.total.currency,
    },
  };
}

/** 구독자가 없다. 알림 기능이 붙을 자리이며, 지금은 사가의 시작을 감사 로그에 남긴다. */
export const orderPlaced = (order: OrderSnapshot, occurredAt: Date): DomainEvent =>
  base(order, ORDER_PLACED, occurredAt);

/** Inventory가 구독해 예약을 확정한다(스펙 §5.6). */
export const orderPaid = (order: OrderSnapshot, occurredAt: Date): DomainEvent =>
  base(order, ORDER_PAID, occurredAt);

/** Inventory가 구독해 예약을 해제한다. */
export function orderPaymentFailed(
  order: OrderSnapshot,
  reason: string,
  occurredAt: Date,
): DomainEvent {
  const event = base(order, ORDER_PAYMENT_FAILED, occurredAt);
  return { ...event, payload: { ...event.payload, reason } };
}

/**
 * Inventory가 구독해 예약을 해제하거나 복원하고, Payment가 구독해 환불한다.
 *
 * `wasPaid`가 payload에 있는 이유: 구독자가 "예약을 해제해야 하는가(아직 확정 전)"와
 * "확정된 재고를 복원해야 하는가(이미 차감됨)"를 갈라야 한다. 이 값이 없으면
 * Inventory가 예약 상태를 보고 추측해야 하고, 추측은 경합에서 틀린다.
 */
export function orderCancelled(
  order: OrderSnapshot,
  wasPaid: boolean,
  occurredAt: Date,
): DomainEvent {
  const event = base(order, ORDER_CANCELLED, occurredAt);
  return { ...event, payload: { ...event.payload, wasPaid } };
}
