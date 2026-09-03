import { DomainError } from '../../../shared/kernel/domain-error';

/**
 * 되돌릴 수 없는 전이를 시도했다. 예: DECLINED 결제를 환불하려 했다.
 *
 * `DomainError`인 이유: 사용자가 취소 버튼을 두 번 누르는 것처럼 정상 요청이
 * 늦게 도착해 생길 수 있고, 클라이언트는 "이미 처리된 결제입니다"를 보여주면 된다.
 * 409다.
 */
export class PaymentConflictError extends DomainError {
  static readonly CODE = 'PAYMENT_CONFLICT';
  readonly code = PaymentConflictError.CODE;

  constructor(paymentId: string, from: string, to: string) {
    super(`${from} 상태의 결제를 ${to}로 바꿀 수 없습니다: ${paymentId}`);
  }
}

export class PaymentNotFoundError extends DomainError {
  static readonly CODE = 'PAYMENT_NOT_FOUND';
  readonly code = PaymentNotFoundError.CODE;

  constructor(key: string) {
    super(`결제를 찾을 수 없습니다: ${key}`);
  }
}

/**
 * 승인액이 주문 금액과 다르다 (스펙 §5.1의 payment 불변식).
 *
 * **`DomainError`가 아니다.** 사용자가 고칠 수 있는 것이 없고, 이 값이 어긋났다면
 * 사가가 잘못된 금액을 넘겼거나 저장된 행이 손상된 것이다. 500이 맞는 응답이다.
 */
export class PaymentAmountMismatchError extends Error {
  constructor(orderId: string, expected: string, actual: string) {
    super(`주문 ${orderId}의 결제 금액이 다릅니다: 기대 ${expected}, 실제 ${actual}`);
    this.name = 'PaymentAmountMismatchError';
  }
}

/** 저장된 결제 행이 알 수 없는 상태를 담고 있다. 데이터 손상이므로 500이다. */
export class CorruptedPaymentError extends Error {
  constructor(paymentId: string, status: string) {
    super(`저장된 결제 상태를 해석할 수 없습니다 (${paymentId}): "${status}"`);
    this.name = 'CorruptedPaymentError';
  }
}
