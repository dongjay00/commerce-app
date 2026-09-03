import type { DomainEvent } from '../../../shared/kernel/domain-event';
import type { OrderId, PaymentId } from '../../../shared/kernel/identifiers';
import type { Money } from '../../../shared/kernel/money';

export const PAYMENT_REFUNDED = 'payment.PaymentRefunded';

/**
 * 환불이 완료됐다. Ordering이 구독해 주문을 REFUNDED로 전이시킨다(스펙 §5.6).
 *
 * payload에는 **JSON 직렬화 가능한 원시 값만** 담는다 — outbox의 payload가 JsonB이고
 * 값 객체를 그대로 넣으면 `{}`로 직렬화되어 조용히 빈 이벤트가 나간다.
 * `bigint`도 직렬화되지 않으므로 금액은 문자열이다.
 */
export function paymentRefunded(
  payment: { readonly id: PaymentId; readonly orderId: OrderId; readonly amount: Money },
  occurredAt: Date,
): DomainEvent {
  return {
    eventType: PAYMENT_REFUNDED,
    aggregateType: 'Payment',
    aggregateId: payment.id,
    occurredAt,
    payload: {
      paymentId: payment.id,
      orderId: payment.orderId,
      amount: payment.amount.amount.toString(),
      currency: payment.amount.currency,
    },
  };
}
