import { describe, expect, it } from 'vitest';
import { moneyDtoSchema } from './money.dto';

describe('moneyDtoSchema', () => {
  it('정규화된 정수 문자열을 통과시킨다', () => {
    expect(() => moneyDtoSchema.parse({ amount: '0', currency: 'KRW' })).not.toThrow();
    expect(() => moneyDtoSchema.parse({ amount: '1000', currency: 'KRW' })).not.toThrow();
    expect(() => moneyDtoSchema.parse({ amount: '-500', currency: 'USD' })).not.toThrow();
  });

  it('빈 문자열을 거부한다', () => {
    expect(() => moneyDtoSchema.parse({ amount: '', currency: 'KRW' })).toThrow();
  });

  it('앞뒤 공백을 거부한다', () => {
    expect(() => moneyDtoSchema.parse({ amount: ' 10 ', currency: 'KRW' })).toThrow();
  });

  it('선행 0을 거부한다', () => {
    expect(() => moneyDtoSchema.parse({ amount: '007', currency: 'KRW' })).toThrow();
  });

  it('부호 있는 0을 거부한다', () => {
    expect(() => moneyDtoSchema.parse({ amount: '-0', currency: 'KRW' })).toThrow();
  });

  it('16진수 문자열을 거부한다', () => {
    expect(() => moneyDtoSchema.parse({ amount: '0x10', currency: 'KRW' })).toThrow();
  });

  it('알 수 없는 통화를 거부한다', () => {
    expect(() => moneyDtoSchema.parse({ amount: '1000', currency: 'EUR' })).toThrow();
  });
});
