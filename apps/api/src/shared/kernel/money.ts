export type Currency = 'KRW' | 'USD';

export class InvalidMoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidMoneyError';
  }
}

export class CurrencyMismatchError extends Error {
  constructor(left: Currency, right: Currency) {
    super(`통화가 다릅니다: ${left} vs ${right}`);
    this.name = 'CurrencyMismatchError';
  }
}

export interface MoneyDto {
  amount: string;
  currency: Currency;
}

/**
 * 금액 값 객체.
 * 최소 단위(원) 정수만 bigint로 보관한다. 부동소수점은 절대 쓰지 않는다.
 */
export class Money {
  private constructor(
    readonly amount: bigint,
    readonly currency: Currency,
  ) {}

  static of(amount: bigint | number, currency: Currency = 'KRW'): Money {
    if (typeof amount === 'number' && !Number.isInteger(amount)) {
      throw new InvalidMoneyError(`금액은 최소 단위 정수여야 합니다: ${amount}`);
    }
    return new Money(BigInt(amount), currency);
  }

  static zero(currency: Currency = 'KRW'): Money {
    return new Money(0n, currency);
  }

  static fromDto(dto: MoneyDto): Money {
    return new Money(BigInt(dto.amount), dto.currency);
  }

  plus(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.amount + other.amount, this.currency);
  }

  minus(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.amount - other.amount, this.currency);
  }

  /** 반올림이 생기지 않도록 정수 배수만 허용한다. */
  multiply(factor: number): Money {
    if (!Number.isInteger(factor)) {
      throw new InvalidMoneyError(`배수는 정수여야 합니다: ${factor}`);
    }
    return new Money(this.amount * BigInt(factor), this.currency);
  }

  equals(other: Money): boolean {
    return this.amount === other.amount && this.currency === other.currency;
  }

  isGreaterThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.amount > other.amount;
  }

  isNegative(): boolean {
    return this.amount < 0n;
  }

  toDto(): MoneyDto {
    return { amount: this.amount.toString(), currency: this.currency };
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new CurrencyMismatchError(this.currency, other.currency);
    }
  }
}
