import { describe, expect, it } from 'vitest';
import { CurrencyMismatchError, InvalidMoneyError, Money } from './money';
import { Quantity } from './quantity';

describe('Money', () => {
  describe('생성', () => {
    it('정수로 생성하면 bigint 최소 단위로 보관한다', () => {
      expect(Money.of(1000).amount).toBe(1000n);
      expect(Money.of(1000).currency).toBe('KRW');
    });

    it('bigint로도 생성할 수 있다', () => {
      expect(Money.of(9_007_199_254_740_993n).amount).toBe(9_007_199_254_740_993n);
    });

    it('소수를 넣으면 거부한다', () => {
      expect(() => Money.of(10.5)).toThrow(InvalidMoneyError);
    });

    it('zero는 0원이다', () => {
      expect(Money.zero().amount).toBe(0n);
    });

    it('음수 금액도 생성할 수 있다 (환불 차액 계산에 필요)', () => {
      expect(Money.of(-500).isNegative()).toBe(true);
    });
  });

  describe('연산', () => {
    it('같은 통화끼리 더한다', () => {
      expect(Money.of(1000).plus(Money.of(500)).amount).toBe(1500n);
    });

    it('같은 통화끼리 뺀다', () => {
      expect(Money.of(1000).minus(Money.of(300)).amount).toBe(700n);
    });

    it('정수 배수를 곱한다', () => {
      expect(Money.of(1200).multiply(3).amount).toBe(3600n);
    });

    it('소수 배수는 거부한다 — 반올림 정책을 암묵적으로 정하지 않는다', () => {
      expect(() => Money.of(1000).multiply(1.5)).toThrow(InvalidMoneyError);
    });

    it('연산해도 원본이 바뀌지 않는다', () => {
      const original = Money.of(1000);
      original.plus(Money.of(500));
      expect(original.amount).toBe(1000n);
    });
  });

  describe('통화 검증', () => {
    it('다른 통화를 더하면 거부한다', () => {
      expect(() => Money.of(1000, 'KRW').plus(Money.of(10, 'USD'))).toThrow(CurrencyMismatchError);
    });

    it('다른 통화를 빼면 거부한다', () => {
      expect(() => Money.of(1000, 'KRW').minus(Money.of(10, 'USD'))).toThrow(CurrencyMismatchError);
    });

    it('다른 통화끼리 비교하면 거부한다', () => {
      expect(() => Money.of(1000, 'KRW').isGreaterThan(Money.of(10, 'USD'))).toThrow(
        CurrencyMismatchError,
      );
    });
  });

  describe('비교', () => {
    it('금액과 통화가 모두 같아야 같다', () => {
      expect(Money.of(1000).equals(Money.of(1000))).toBe(true);
      expect(Money.of(1000).equals(Money.of(1001))).toBe(false);
      expect(Money.of(1000, 'KRW').equals(Money.of(1000, 'USD'))).toBe(false);
    });

    it('크기를 비교한다', () => {
      expect(Money.of(1000).isGreaterThan(Money.of(999))).toBe(true);
      expect(Money.of(1000).isGreaterThan(Money.of(1000))).toBe(false);
    });
  });

  describe('DTO 변환', () => {
    it('amount를 문자열로 직렬화한다 — JSON에는 bigint가 없다', () => {
      expect(Money.of(1000).toDto()).toEqual({ amount: '1000', currency: 'KRW' });
    });

    it('DTO에서 복원하면 원본과 같다', () => {
      const original = Money.of(123_456, 'KRW');
      expect(Money.fromDto(original.toDto()).equals(original)).toBe(true);
    });

    it('빈 문자열을 거부한다 — BigInt("")는 0n이라 무검증이면 조용히 0원이 된다', () => {
      expect(() => Money.fromDto({ amount: '', currency: 'KRW' })).toThrow(InvalidMoneyError);
    });

    it('앞뒤 공백을 거부한다 — BigInt는 공백을 허용해 통과시킨다', () => {
      expect(() => Money.fromDto({ amount: ' 10 ', currency: 'KRW' })).toThrow(InvalidMoneyError);
    });

    it('선행 0을 거부한다 — 정규화되지 않은 표현이다', () => {
      expect(() => Money.fromDto({ amount: '007', currency: 'KRW' })).toThrow(InvalidMoneyError);
    });

    it('부호 있는 0을 거부한다 — "-0"은 0의 정규화된 표현이 아니다', () => {
      expect(() => Money.fromDto({ amount: '-0', currency: 'KRW' })).toThrow(InvalidMoneyError);
    });

    it('16진수 문자열을 거부한다 — BigInt("0x10")은 16n이다', () => {
      expect(() => Money.fromDto({ amount: '0x10', currency: 'KRW' })).toThrow(InvalidMoneyError);
    });

    it('정상 정수 문자열은 통과한다', () => {
      expect(Money.fromDto({ amount: '0', currency: 'KRW' }).amount).toBe(0n);
      expect(Money.fromDto({ amount: '-500', currency: 'KRW' }).amount).toBe(-500n);
      expect(Money.fromDto({ amount: '15000', currency: 'KRW' }).amount).toBe(15000n);
    });
  });
});

describe('Money.multiply — Quantity 오버로드', () => {
  it('Quantity를 곱한다', () => {
    // 스펙 §6.5의 시그니처다. .value를 꺼내 쓰면 Quantity의 불변식이 호출부로 샌다.
    expect(Money.of(1200).multiply(Quantity.positive(3)).amount).toBe(3600n);
  });

  it('수량 0을 곱하면 0원이다', () => {
    expect(Money.of(1200).multiply(Quantity.of(0)).amount).toBe(0n);
  });

  it('통화는 그대로 유지된다', () => {
    expect(Money.of(500, 'USD').multiply(Quantity.positive(2)).currency).toBe('USD');
  });

  it('number 오버로드도 그대로 동작한다', () => {
    // 기존 호출부를 깨지 않는다.
    expect(Money.of(1200).multiply(3).amount).toBe(3600n);
  });
});

describe('Money.sum', () => {
  it('여러 금액을 더한다', () => {
    const total = Money.sum([Money.of(1000), Money.of(2500), Money.of(300)]);
    expect(total.amount).toBe(3800n);
  });

  it('빈 배열이면 fallback 통화의 0원이다', () => {
    // 주문에 라인이 없는 경우는 Order가 막지만, sum 자체는 총계 계산기로서
    // 빈 입력에 답을 내야 한다. 통화를 추론할 근거가 없으므로 인자로 받는다.
    expect(Money.sum([], 'USD')).toEqual(Money.zero('USD'));
    expect(Money.sum([])).toEqual(Money.zero('KRW'));
  });

  it('통화가 섞이면 CurrencyMismatchError다', () => {
    // 이 예외에 도달하는 것은 호출자의 버그다. 주문 경로에서는 Order.place가
    // 먼저 MixedCurrencyOrderError(422)로 막는다(태스크 9).
    expect(() => Money.sum([Money.of(100, 'KRW'), Money.of(100, 'USD')])).toThrow(
      CurrencyMismatchError,
    );
  });
});
