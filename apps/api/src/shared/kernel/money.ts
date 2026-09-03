import type { Quantity } from './quantity';

export type Currency = 'KRW' | 'USD';

export class InvalidMoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidMoneyError';
  }
}

/**
 * 서로 다른 통화의 Money끼리 연산하려 할 때 던진다. DomainError로 승격하지 않는다 —
 * 이게 실제로 발생한다면 사용자 입력 문제가 아니라 Cart가 통화가 다른 라인을
 * 애초에 허용했다는 뜻이고, 그건 불변식의 구멍이다. 사용자가 고칠 수 없으므로 500이
 * 맞는 응답이다. TODO(plan 4): Cart에 단일 통화 불변식을 추가해 이 경로 자체가
 * 발생하지 않도록 한다.
 */
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

// '0' 또는 앞자리가 0이 아닌 (선택적으로 음수인) 정수 문자열만 허용한다.
// ''(BigInt('')는 0n), ' 10 '(공백 허용), '007'(선행 0), '-0'(부호 있는 0)을 모두 거부한다.
const AMOUNT_PATTERN = /^(0|-?[1-9]\d*)$/;

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
    if (!AMOUNT_PATTERN.test(dto.amount)) {
      throw new InvalidMoneyError(`금액은 정규화된 정수 문자열이어야 합니다: "${dto.amount}"`);
    }
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

  /**
   * 반올림이 생기지 않도록 정수 배수만 허용한다.
   *
   * `Quantity` 오버로드가 스펙 §6.5가 적은 시그니처다. `number`도 계속 받는 이유는
   * 수량이 아닌 배수(예: 2배 프로모션)가 있을 수 있기 때문이고, 주문 라인처럼
   * 수량을 곱하는 자리에서는 반드시 `Quantity`를 넘긴다 — `.value`를 꺼내 쓰면
   * `Quantity`가 지키던 "정수이고 음수가 아니다"가 호출부의 책임으로 돌아온다.
   */
  multiply(times: Quantity | number): Money {
    const factor = typeof times === 'number' ? times : times.value;
    if (!Number.isInteger(factor)) {
      throw new InvalidMoneyError(`배수는 정수여야 합니다: ${factor}`);
    }
    return new Money(this.amount * BigInt(factor), this.currency);
  }

  /**
   * 합계. 빈 배열이면 통화를 추론할 근거가 없으므로 `fallbackCurrency`의 0원을 준다.
   *
   * 주문 총액이 이 함수 하나로 계산된다. 호출부마다 `reduce`를 손으로 쓰면
   * 통화 검사를 빠뜨린 곳이 하나쯤 생기고, 금액 버그는 커머스에서 가장 비싸다.
   */
  static sum(values: readonly Money[], fallbackCurrency: Currency = 'KRW'): Money {
    const first = values[0];
    if (first === undefined) {
      return Money.zero(fallbackCurrency);
    }
    return values.slice(1).reduce((acc, value) => acc.plus(value), first);
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
