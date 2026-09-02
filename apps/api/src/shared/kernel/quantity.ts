export class InvalidQuantityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidQuantityError';
  }
}

export class NegativeQuantityError extends Error {
  constructor(left: number, right: number) {
    super(`수량이 음수가 됩니다: ${left} - ${right}`);
    this.name = 'NegativeQuantityError';
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
    if (!Number.isInteger(value)) {
      throw new InvalidQuantityError(`수량은 정수여야 합니다: ${value}`);
    }
    if (value < 0) {
      throw new InvalidQuantityError(`수량은 0 이상이어야 합니다: ${value}`);
    }
    return new Quantity(value);
  }

  static positive(value: number): Quantity {
    if (!Number.isInteger(value)) {
      throw new InvalidQuantityError(`수량은 정수여야 합니다: ${value}`);
    }
    if (value < 1) {
      throw new InvalidQuantityError(`수량은 1 이상이어야 합니다: ${value}`);
    }
    return new Quantity(value);
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
