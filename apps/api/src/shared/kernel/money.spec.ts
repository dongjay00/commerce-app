import { describe, expect, it } from 'vitest';
import { CurrencyMismatchError, InvalidMoneyError, Money } from './money';

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
  });
});
