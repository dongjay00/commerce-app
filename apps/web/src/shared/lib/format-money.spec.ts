import { describe, expect, it } from 'vitest';
import { formatMoney } from './format-money';

describe('formatMoney', () => {
  it('원화는 천 단위 구분 기호와 원 단위로 표시한다', () => {
    expect(formatMoney({ amount: '15000', currency: 'KRW' })).toBe('15,000원');
  });

  it('백만 단위도 올바르게 끊는다', () => {
    expect(formatMoney({ amount: '1234567', currency: 'KRW' })).toBe('1,234,567원');
  });

  it('0원을 표시한다', () => {
    expect(formatMoney({ amount: '0', currency: 'KRW' })).toBe('0원');
  });

  it('세 자리 미만은 구분 기호가 없다', () => {
    expect(formatMoney({ amount: '500', currency: 'KRW' })).toBe('500원');
  });

  it('음수는 부호를 앞에 붙인다', () => {
    expect(formatMoney({ amount: '-5000', currency: 'KRW' })).toBe('-5,000원');
  });

  it('달러는 최소 단위가 센트이므로 소수 두 자리로 환산한다', () => {
    expect(formatMoney({ amount: '123456', currency: 'USD' })).toBe('$1,234.56');
  });

  it('1달러 미만의 센트도 올바르게 표시한다', () => {
    expect(formatMoney({ amount: '5', currency: 'USD' })).toBe('$0.05');
  });
});
