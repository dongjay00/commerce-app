import { DomainError } from './domain-error';

/**
 * `of`에 음수가 들어온 경우처럼, 도달했다면 코드 버그인 상황에만 남긴다.
 * 재고 잔량이 음수가 되는 것은 사용자가 만들 수 있는 상태가 아니라 호출자의 버그다.
 * DomainError로 만들지 않으므로 500으로 떨어진다.
 */
export class InvalidQuantityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidQuantityError';
  }
}

/**
 * 정수가 아닌 수량. 사용자가 보낸 값이 그대로 도달할 수 있는 자리이므로 DomainError로
 * 승격해 400을 낸다.
 *
 * 이전 구현은 `assertInteger`가 `InvalidQuantityError`(일반 Error)를 던졌고, 그 호출이
 * `< 1` 검사보다 **먼저** 있었다. 결과적으로 `positive(-3.5)`는 422가 아니라 500이 됐다.
 * 검사 순서를 바꾸는 대신 예외를 분류한 이유는, 순서만 바꾸면 `positive(2.5)`가 여전히
 * 500이라 반쪽짜리 수정이 되기 때문이다.
 *
 * 어댑터의 Zod 스키마는 이 예외에 의존하지 말고 `.int()`를 함께 걸어야 한다 —
 * 형식은 Zod가, 의미는 VO가 지킨다(스펙 §8.4). 이 예외는 그 방어선이 뚫렸을 때의 두 번째 그물이다.
 */
export class NonIntegerQuantityError extends DomainError {
  static readonly CODE = 'QUANTITY_NOT_INTEGER';
  readonly code = NonIntegerQuantityError.CODE;

  constructor(value: number) {
    super(`수량은 정수여야 합니다: ${value}`);
  }
}

/**
 * `positive`가 요구하는 최소값(1) 미만인 사용자 입력. 스펙 §8.4의 분류상 사용자가
 * 고칠 수 있는 값이므로 DomainError로 승격해 422로 응답한다 — `InvalidQuantityError`와
 * 달리 이건 프로그래머 에러가 아니다. `of`/`assertInteger`가 던지는 나머지 세 자리는
 * 여전히 프로그래머 에러이므로 분리했다.
 */
export class QuantityBelowMinimumError extends DomainError {
  static readonly CODE = 'QUANTITY_BELOW_MINIMUM';
  readonly code = QuantityBelowMinimumError.CODE;

  constructor(value: number) {
    super(`수량은 1 이상이어야 합니다: ${value}`);
  }
}

/**
 * `minus`의 결과가 음수가 되는 경우. 호출자가 보유량보다 큰 값을 빼려 한 것이므로
 * 사용자가 유발할 수 있는 상태 충돌(409)이다 — DomainError로 등록한다.
 */
export class NegativeQuantityError extends DomainError {
  static readonly CODE = 'NEGATIVE_QUANTITY';
  readonly code = NegativeQuantityError.CODE;

  constructor(left: number, right: number) {
    super(`수량이 음수가 됩니다: ${left} - ${right}`);
  }
}

/**
 * 수량 값 객체.
 * - `of`: 0 이상. 재고 잔량처럼 0이 유효한 값인 경우.
 * - `positive`: 1 이상. 주문·장바구니 라인처럼 0이면 줄 자체가 없어야 하는 경우.
 */
export class Quantity {
  static readonly ZERO = new Quantity(0);

  private constructor(readonly value: number) {}

  static of(value: number): Quantity {
    Quantity.assertInteger(value);
    if (value < 0) {
      throw new InvalidQuantityError(`수량은 0 이상이어야 합니다: ${value}`);
    }
    return new Quantity(value);
  }

  static positive(value: number): Quantity {
    Quantity.assertInteger(value);
    if (value < 1) {
      throw new QuantityBelowMinimumError(value);
    }
    return new Quantity(value);
  }

  private static assertInteger(value: number): void {
    if (!Number.isInteger(value)) {
      throw new NonIntegerQuantityError(value);
    }
  }

  plus(other: Quantity): Quantity {
    return new Quantity(this.value + other.value);
  }

  minus(other: Quantity): Quantity {
    const result = this.value - other.value;
    if (result < 0) {
      throw new NegativeQuantityError(this.value, other.value);
    }
    return new Quantity(result);
  }

  isGreaterThan(other: Quantity): boolean {
    return this.value > other.value;
  }

  isZero(): boolean {
    return this.value === 0;
  }

  equals(other: Quantity): boolean {
    return this.value === other.value;
  }
}
