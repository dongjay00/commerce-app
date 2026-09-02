import { DomainError } from './domain-error';

/**
 * `of`의 음수/비정수 입력, `positive`/`of` 공통의 비정수 입력처럼 검증을 통과한
 * 값만 VO에 들어온다는 전제가 깨졌을 때 던진다 — 즉 호출자(어댑터의 Zod 검증 등)가
 * 이미 걸렀어야 할 값이 여기까지 온 프로그래머 에러다. DomainError로 만들지 않는다:
 * 사용자가 고칠 수 있는 게 아니라 코드 버그이므로 500으로 떨어지는 게 맞다.
 */
export class InvalidQuantityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidQuantityError';
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
      throw new InvalidQuantityError(`수량은 정수여야 합니다: ${value}`);
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
