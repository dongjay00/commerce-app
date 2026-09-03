import { DomainError } from '../../../../shared/kernel/domain-error';

/** 라인이 없는 주문은 만들 수 없다 — 스펙 §5.1의 "최소 1줄". */
export class EmptyOrderError extends DomainError {
  static readonly CODE = 'EMPTY_ORDER';
  readonly code = EmptyOrderError.CODE;

  constructor() {
    super('주문에는 최소 한 개의 상품이 있어야 합니다.');
  }
}

/**
 * 통화가 다른 라인이 섞였다 — 편차 2.
 *
 * 계획 3의 `money.ts`에 남은 `TODO(plan 4)`가 요구한 것이다. 이것이 없으면
 * `Money.plus`의 `CurrencyMismatchError`(평문 `Error`)가 튀어나와 500이 나가고,
 * 사용자는 왜 실패했는지 알 수 없다. 여기서 막으면 422와 함께 이유를 말할 수 있다.
 */
export class MixedCurrencyOrderError extends DomainError {
  static readonly CODE = 'MIXED_CURRENCY_ORDER';
  readonly code = MixedCurrencyOrderError.CODE;

  constructor(currencies: readonly string[]) {
    super(`한 주문에 통화를 섞을 수 없습니다: ${currencies.join(', ')}`);
  }
}

/** 되돌릴 수 없는 상태 전이를 시도했다. 409다. */
export class OrderConflictError extends DomainError {
  static readonly CODE = 'ORDER_CONFLICT';
  readonly code = OrderConflictError.CODE;

  constructor(orderId: string, from: string, to: string) {
    super(`${from} 상태의 주문을 ${to}로 바꿀 수 없습니다: ${orderId}`);
  }
}

/**
 * 남의 주문에 접근하려 했다.
 *
 * **가드가 아니라 도메인에 있다** — 스펙 §5.5가 명시한 유일한 도메인 인가 규칙이다.
 * 가드로 처리하면 HTTP가 아닌 경로(배치, 이벤트 핸들러, 관리자 CLI)로 들어올 때
 * 규칙이 통째로 사라진다.
 */
export class OrderNotOwnedError extends DomainError {
  static readonly CODE = 'ORDER_NOT_OWNED';
  readonly code = OrderNotOwnedError.CODE;

  constructor(orderId: string) {
    super(`이 주문에 접근할 수 없습니다: ${orderId}`);
  }
}

export class OrderNotFoundError extends DomainError {
  static readonly CODE = 'ORDER_NOT_FOUND';
  readonly code = OrderNotFoundError.CODE;

  constructor(orderId: string) {
    super(`주문을 찾을 수 없습니다: ${orderId}`);
  }
}

/** 저장된 주문 행이 알 수 없는 상태를 담고 있다. 데이터 손상이므로 500이다. */
export class CorruptedOrderError extends Error {
  constructor(orderId: string, detail: string) {
    super(`저장된 주문을 해석할 수 없습니다 (${orderId}): ${detail}`);
    this.name = 'CorruptedOrderError';
  }
}

/** 인바운드 배송지가 비어 있다. 사용자가 고칠 수 있으므로 400이다. */
export class InvalidShippingAddressError extends DomainError {
  static readonly CODE = 'INVALID_SHIPPING_ADDRESS';
  readonly code = InvalidShippingAddressError.CODE;

  constructor(field: string) {
    super(`배송지 정보가 올바르지 않습니다: ${field}`);
  }
}

/** 저장된 배송지가 비어 있다. 우리 데이터가 깨진 것이므로 500이다. */
export class CorruptedShippingAddressError extends Error {
  constructor(field: string) {
    super(`저장된 배송지 값이 비어 있습니다: ${field}`);
    this.name = 'CorruptedShippingAddressError';
  }
}
