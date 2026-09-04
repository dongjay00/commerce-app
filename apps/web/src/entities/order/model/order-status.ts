import type { OrderDto } from '@commerce/contracts';

type OrderStatus = OrderDto['status'];

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  PENDING_PAYMENT: '결제 대기',
  PAID: '결제 완료',
  PAYMENT_FAILED: '결제 실패',
  CANCELLED: '취소됨',
  // 계획 4의 편차 1이 더한 상태. 취소 요청과 환불 완료 사이다.
  REFUND_PENDING: '환불 처리 중',
  REFUNDED: '환불 완료',
};

export function orderStatusLabel(status: OrderStatus): string {
  return ORDER_STATUS_LABELS[status];
}

/**
 * 취소 버튼을 그릴지 말지. **표현 판단이지 도메인 규칙이 아니다** —
 * 진짜 규칙은 `Order.cancelBy`가 지키고, 여기가 틀리면 서버가 409로 거절한다.
 * 그 이중 방어가 정상이다(스펙 §8.1은 BFF가 *계산*하는 것을 금지했고, 이것은
 * 계산이 아니라 버튼 노출 여부다).
 *
 * `REFUND_PENDING`을 제외하는 이유: 서버는 멱등해서 눌러도 안전하지만, 취소
 * 버튼을 다시 보여주면 이미 취소했다는 사실이 사용자에게 전달되지 않는다.
 */
export function isOrderCancellable(status: OrderStatus): boolean {
  return status === 'PENDING_PAYMENT' || status === 'PAID';
}
