import { describe, expect, it } from 'vitest';
import { addCartItemBodySchema, cartContract, cartDtoSchema } from './cart.contract';
import {
  listMyOrdersQuerySchema,
  orderContract,
  orderDtoSchema,
  placeOrderBodySchema,
} from './order.contract';

const uuid = () => crypto.randomUUID();

describe('cartContract', () => {
  it('빈 장바구니 뷰가 통과한다', () => {
    const parsed = cartDtoSchema.safeParse({
      cartId: null,
      lines: [],
      total: { amount: '0', currency: 'KRW' },
      unavailableSkuIds: [],
    });
    expect(parsed.success).toBe(true);
  });

  it('수량이 비정수면 거부한다', () => {
    // M6: 형식은 여기서 걸러야 한다. 도메인은 두 번째 그물이다.
    expect(addCartItemBodySchema.safeParse({ skuId: uuid(), quantity: 1.5 }).success).toBe(false);
  });

  it('수량 0은 거부한다', () => {
    expect(addCartItemBodySchema.safeParse({ skuId: uuid(), quantity: 0 }).success).toBe(false);
  });

  it('모르는 필드는 거부한다', () => {
    expect(addCartItemBodySchema.safeParse({ skuId: uuid(), quantity: 1, extra: 1 }).success).toBe(
      false,
    );
  });

  it('각 라우트가 낼 수 있는 상태를 모두 선언한다', () => {
    expect(Object.keys(cartContract.get.responses).map(Number).sort()).toEqual([200, 401]);
    expect(Object.keys(cartContract.addItem.responses).map(Number).sort()).toEqual([
      204, 400, 401, 422,
    ]);
    expect(Object.keys(cartContract.removeItem.responses).map(Number).sort()).toEqual([
      204, 400, 401, 404,
    ]);
  });
});

describe('orderContract', () => {
  const ORDER = {
    id: uuid(),
    status: 'PAID' as const,
    total: { amount: '4600', currency: 'KRW' as const },
    placedAt: '2026-03-01T00:00:00.000Z',
    shippingAddress: {
      recipient: '홍길동',
      phone: '010-1234-5678',
      zip: '06236',
      line1: '서울시',
      line2: null,
    },
    lines: [
      {
        skuId: uuid(),
        nameSnapshot: '티셔츠 RED-M',
        unitPrice: { amount: '1200', currency: 'KRW' as const },
        quantity: 3,
        subtotal: { amount: '3600', currency: 'KRW' as const },
      },
    ],
  };

  it('주문 뷰가 통과한다', () => {
    expect(orderDtoSchema.safeParse(ORDER).success).toBe(true);
  });

  it('customerId가 붙으면 거부한다', () => {
    // 와이어에 남의 고객 id를 실을 여지를 만들지 않는다.
    expect(orderDtoSchema.safeParse({ ...ORDER, customerId: uuid() }).success).toBe(false);
  });

  it('라인이 없는 주문은 거부한다', () => {
    expect(orderDtoSchema.safeParse({ ...ORDER, lines: [] }).success).toBe(false);
  });

  it('REFUND_PENDING이 유효한 상태다', () => {
    // 편차 1. 계약이 그 상태를 모르면 클라이언트가 파싱에 실패한다.
    expect(orderDtoSchema.safeParse({ ...ORDER, status: 'REFUND_PENDING' }).success).toBe(true);
  });

  it('모르는 상태는 거부한다', () => {
    expect(orderDtoSchema.safeParse({ ...ORDER, status: 'SHIPPED' }).success).toBe(false);
  });

  it('addressId가 uuid가 아니면 거부한다', () => {
    expect(placeOrderBodySchema.safeParse({ addressId: 'nope' }).success).toBe(false);
  });

  it('목록 limit 상한이 100이다', () => {
    expect(listMyOrdersQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
    expect(listMyOrdersQuerySchema.safeParse({ limit: '100' }).success).toBe(true);
  });

  it('목록 쿼리에 기본값이 있다', () => {
    expect(listMyOrdersQuerySchema.parse({})).toEqual({ limit: 20, offset: 0 });
  });

  it('각 라우트가 낼 수 있는 상태를 모두 선언한다', () => {
    expect(Object.keys(orderContract.place.responses).map(Number).sort()).toEqual([
      201, 400, 401, 404, 409, 422,
    ]);
    expect(Object.keys(orderContract.get.responses).map(Number).sort()).toEqual([
      200, 400, 401, 403, 404,
    ]);
    expect(Object.keys(orderContract.cancel.responses).map(Number).sort()).toEqual([
      200, 400, 401, 403, 404, 409,
    ]);
  });
});
