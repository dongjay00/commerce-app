import { describe, expect, it } from 'vitest';
import { InvalidQuantityError, NegativeQuantityError, Quantity } from './quantity';

describe('Quantity', () => {
  describe('of — 재고 잔량용 (0 이상)', () => {
    it('0을 허용한다', () => {
      expect(Quantity.of(0).value).toBe(0);
    });

    it('양의 정수를 허용한다', () => {
      expect(Quantity.of(7).value).toBe(7);
    });

    it('음수를 거부한다', () => {
      expect(() => Quantity.of(-1)).toThrow(InvalidQuantityError);
    });

    it('소수를 거부한다', () => {
      expect(() => Quantity.of(1.5)).toThrow(InvalidQuantityError);
    });
  });

  describe('positive — 주문 라인용 (1 이상)', () => {
    it('1 이상을 허용한다', () => {
      expect(Quantity.positive(1).value).toBe(1);
    });

    it('0을 거부한다 — 장바구니에 수량 0인 줄은 존재할 수 없다', () => {
      expect(() => Quantity.positive(0)).toThrow(InvalidQuantityError);
    });

    it('음수를 거부한다', () => {
      expect(() => Quantity.positive(-3)).toThrow(InvalidQuantityError);
    });
  });

  describe('연산', () => {
    it('더한다', () => {
      expect(Quantity.of(3).plus(Quantity.of(4)).value).toBe(7);
    });

    it('뺀다', () => {
      expect(Quantity.of(10).minus(Quantity.of(4)).value).toBe(6);
    });

    it('결과가 음수가 되는 뺄셈은 거부한다 — 재고가 음수가 될 수 없다', () => {
      expect(() => Quantity.of(3).minus(Quantity.of(5))).toThrow(NegativeQuantityError);
    });

    it('연산해도 원본이 바뀌지 않는다', () => {
      const original = Quantity.of(5);
      original.plus(Quantity.of(2));
      expect(original.value).toBe(5);
    });
  });

  describe('비교', () => {
    it('크기를 비교한다', () => {
      expect(Quantity.of(5).isGreaterThan(Quantity.of(4))).toBe(true);
      expect(Quantity.of(5).isGreaterThan(Quantity.of(5))).toBe(false);
    });

    it('0인지 판별한다', () => {
      expect(Quantity.ZERO.isZero()).toBe(true);
      expect(Quantity.of(1).isZero()).toBe(false);
    });

    it('값이 같으면 같다', () => {
      expect(Quantity.of(3).equals(Quantity.of(3))).toBe(true);
    });
  });
});
