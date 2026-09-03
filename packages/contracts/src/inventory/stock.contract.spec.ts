import { describe, expect, it } from 'vitest';
import { registerStockBodySchema, restockBodySchema, stockContract } from './stock.contract';

describe('stockContract', () => {
  it('보유량 0 등록은 통과한다', () => {
    expect(
      registerStockBodySchema.safeParse({ skuId: crypto.randomUUID(), onHand: 0 }).success,
    ).toBe(true);
  });

  it('보유량이 비정수면 거부한다', () => {
    // M6: 형식은 여기서 걸러야 한다. 도메인은 두 번째 그물이다.
    expect(
      registerStockBodySchema.safeParse({ skuId: crypto.randomUUID(), onHand: 1.5 }).success,
    ).toBe(false);
  });

  it('입고 수량 0은 거부한다', () => {
    expect(restockBodySchema.safeParse({ quantity: 0 }).success).toBe(false);
    expect(restockBodySchema.safeParse({ quantity: 1 }).success).toBe(true);
  });

  it('모르는 필드는 거부한다', () => {
    expect(
      registerStockBodySchema.safeParse({ skuId: crypto.randomUUID(), onHand: 1, extra: 1 })
        .success,
    ).toBe(false);
  });

  it('각 라우트가 낼 수 있는 상태를 모두 선언한다', () => {
    // 선언하지 않은 상태로 응답하면 ts-rest 클라이언트가 타입을 좁히지 못한다.
    expect(Object.keys(stockContract.register.responses).map(Number).sort()).toEqual([
      201, 400, 401, 409,
    ]);
    expect(Object.keys(stockContract.get.responses).map(Number).sort()).toEqual([
      200, 400, 401, 404,
    ]);
    expect(Object.keys(stockContract.restock.responses).map(Number).sort()).toEqual([
      204, 400, 401, 404,
    ]);
  });
});
