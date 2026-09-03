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

/** 빈 장바구니로는 주문할 수 없다. */
export class EmptyCartError extends DomainError {
  static readonly CODE = 'EMPTY_CART';
  readonly code = EmptyCartError.CODE;

  constructor() {
    super('장바구니가 비어 있습니다.');
  }
}

/**
 * 장바구니에 있는 SKU를 Catalog가 모른다. 상품이 삭제되거나 비활성화된 경우다.
 *
 * 422인 이유: 사용자가 장바구니에서 그 줄을 빼면 해결된다. 어느 SKU인지 메시지에
 * 담아 클라이언트가 그 줄을 표시할 수 있게 한다.
 */
export class UnknownSkuError extends DomainError {
  static readonly CODE = 'UNKNOWN_SKU';
  readonly code = UnknownSkuError.CODE;

  constructor(skuIds: readonly string[]) {
    super(`판매 중이 아닌 상품이 있습니다: ${skuIds.join(', ')}`);
  }
}

/**
 * 재고가 모자라 예약에 실패했다.
 *
 * Inventory의 `InsufficientStockError`를 그대로 쓰지 않는다 — Core가 Supporting의
 * 예외 타입에 묶이면 Inventory를 별도 서비스로 떼어낼 때 그 타입이 프로세스 경계를
 * 넘어야 한다. ACL이 값만 번역해 이 예외로 바꾼다.
 */
export class OutOfStockError extends DomainError {
  static readonly CODE = 'OUT_OF_STOCK';
  readonly code = OutOfStockError.CODE;

  constructor(skuId: string) {
    super(`재고가 부족합니다: ${skuId}`);
  }
}

/** 주문에 지정한 배송지가 이 고객의 주소록에 없다. */
export class ShippingAddressNotFoundError extends DomainError {
  static readonly CODE = 'SHIPPING_ADDRESS_NOT_FOUND';
  readonly code = ShippingAddressNotFoundError.CODE;

  constructor(addressId: string) {
    super(`배송지를 찾을 수 없습니다: ${addressId}`);
  }
}
