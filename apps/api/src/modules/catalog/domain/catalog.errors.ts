import { DomainError } from '../../../shared/kernel/domain-error';

/**
 * 가격이 0 이하다. `Money`는 0과 음수를 허용해야 한다 — 환불 계산의 중간값이 그렇다.
 * 판매 가격은 다르다: 0원짜리 상품은 재고·결제 경로 전체에서 의미가 무너진다.
 * 그 차이가 `Price`가 `Money` 위에 존재하는 유일한 이유다.
 */
export class InvalidPriceError extends DomainError {
  static readonly CODE = 'INVALID_PRICE';
  readonly code = InvalidPriceError.CODE;

  constructor(amount: bigint) {
    super(`가격은 0보다 커야 합니다: ${amount}`);
  }
}

/** 상품 이름이 비어 있거나 SKU가 하나도 없다. */
export class InvalidProductError extends DomainError {
  static readonly CODE = 'INVALID_PRODUCT';
  readonly code = InvalidProductError.CODE;

  constructor(reason: string) {
    super(`상품을 만들 수 없습니다: ${reason}`);
  }
}

/**
 * 한 상품 안에 같은 SKU 코드가 둘이다. 코드는 사람이 읽고 입력하는 식별자라
 * 중복되면 "어느 쪽 가격인가"를 아무도 답할 수 없다.
 */
export class DuplicateSkuCodeError extends DomainError {
  static readonly CODE = 'DUPLICATE_SKU_CODE';
  readonly code = DuplicateSkuCodeError.CODE;

  constructor(code: string) {
    super(`SKU 코드가 중복됩니다: ${code}`);
  }
}

/**
 * 그 상품에 없는 SKU다. 다른 상품의 SKU ID를 넣었을 때도 이것이 난다 —
 * 404로 답해 "그 ID는 존재하지만 이 상품 것이 아니다"를 흘리지 않는다.
 * 계획 2의 `AddressNotFoundError`와 같은 판단이다.
 */
export class SkuNotFoundError extends DomainError {
  static readonly CODE = 'SKU_NOT_FOUND';
  readonly code = SkuNotFoundError.CODE;

  constructor(skuId: string) {
    super(`SKU를 찾을 수 없습니다: ${skuId}`);
  }
}

/**
 * 저장된 가격이 0 이하다. 정상 경로로는 불가능하다 — `Price.of`가 막기 때문이다.
 * 도달했다면 데이터가 손상된 것이고 사용자가 고칠 수 없으므로 `DomainError`가 아니다.
 */
export class CorruptedPriceError extends Error {
  constructor(amount: bigint) {
    super(`저장된 가격이 0 이하입니다: ${amount}`);
    this.name = 'CorruptedPriceError';
  }
}

/** 저장된 상품 행이 불변식을 어긴 상태다(SKU 없음, 코드 중복 등). */
export class CorruptedProductError extends Error {
  constructor(productId: string, reason: string) {
    super(`저장된 상품 ${productId}이(가) 손상되었습니다: ${reason}`);
    this.name = 'CorruptedProductError';
  }
}
