import { describe, expect, it } from 'vitest';
import { ErrorCode, errorDtoSchema } from './error-codes';

describe('ErrorCode', () => {
  it('값이 서로 중복되지 않는다 — 프론트가 이 값으로 분기한다', () => {
    const values = Object.values(ErrorCode);
    expect(new Set(values).size).toBe(values.length);
  });

  it('값이 전부 SCREAMING_SNAKE_CASE다', () => {
    for (const value of Object.values(ErrorCode)) {
      expect(value).toMatch(/^[A-Z][A-Z_]*$/);
    }
  });

  it('주문 파이프라인이 쓰는 코드를 포함한다', () => {
    expect(ErrorCode.INSUFFICIENT_STOCK).toBe('INSUFFICIENT_STOCK');
    expect(ErrorCode.ORDER_NOT_CANCELLABLE).toBe('ORDER_NOT_CANCELLABLE');
    expect(ErrorCode.PAYMENT_DECLINED).toBe('PAYMENT_DECLINED');
  });
});

describe('errorDtoSchema', () => {
  it('유효한 에러 응답을 통과시킨다', () => {
    const parsed = errorDtoSchema.parse({
      code: ErrorCode.INSUFFICIENT_STOCK,
      message: '재고가 부족합니다',
    });
    expect(parsed.code).toBe('INSUFFICIENT_STOCK');
  });

  it('알 수 없는 코드를 거부한다', () => {
    expect(() => errorDtoSchema.parse({ code: 'MADE_UP', message: 'x' })).toThrow();
  });

  it('message가 없으면 거부한다', () => {
    expect(() => errorDtoSchema.parse({ code: ErrorCode.NOT_FOUND })).toThrow();
  });
});
