/**
 * 주문 상태. **사가 상태를 겸한다** — 스펙 §6.2가 별도 사가 엔티티를 두지 않기로 했다.
 *
 * `REFUND_PENDING`은 스펙 §5.4의 다이어그램에 없다(편차 1). 취소 요청과 환불 완료
 * 사이에 주문이 `PAID`로 남으면 (1) 고객에게 거짓말을 하고 (2) 취소가 멱등하지 않아
 * at-least-once 배달에서 환불이 두 번 요청된다.
 */
export type OrderStatus =
  | 'PENDING_PAYMENT'
  | 'PAID'
  | 'PAYMENT_FAILED'
  | 'CANCELLED'
  | 'REFUND_PENDING'
  | 'REFUNDED';

export const ORDER_STATUSES: readonly OrderStatus[] = [
  'PENDING_PAYMENT',
  'PAID',
  'PAYMENT_FAILED',
  'CANCELLED',
  'REFUND_PENDING',
  'REFUNDED',
];

export function isOrderStatus(value: string): value is OrderStatus {
  return (ORDER_STATUSES as readonly string[]).includes(value);
}

/** 아직 결말이 나지 않은 주문. 조회 화면이 "진행 중"으로 묶는 기준이다. */
export function isOrderOpen(status: OrderStatus): boolean {
  return status === 'PENDING_PAYMENT' || status === 'REFUND_PENDING';
}
