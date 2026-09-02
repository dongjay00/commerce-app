import { describe, expect, it } from 'vitest';
import { CustomerId, InvalidIdError, OrderId, SkuId } from './identifiers';

const VALID_UUID = '0192f3a0-1234-7abc-8def-0123456789ab';

describe('식별자', () => {
  it('UUID 형식이면 생성된다', () => {
    expect(OrderId.of(VALID_UUID)).toBe(VALID_UUID);
  });

  it('UUID가 아니면 거부한다', () => {
    expect(() => OrderId.of('order-1')).toThrow(InvalidIdError);
  });

  it('빈 문자열을 거부한다', () => {
    expect(() => OrderId.of('')).toThrow(InvalidIdError);
  });

  it('대문자 UUID도 허용한다', () => {
    expect(() => SkuId.of(VALID_UUID.toUpperCase())).not.toThrow();
  });

  it('서로 다른 ID 타입은 컴파일 단계에서 섞이지 않는다', () => {
    // 런타임에는 같은 문자열이지만 타입이 다르다.
    // 아래 주석을 해제하면 `pnpm typecheck`가 실패해야 한다:
    //   const wrong: OrderId = CustomerId.of(VALID_UUID);
    const orderId = OrderId.of(VALID_UUID);
    const customerId = CustomerId.of(VALID_UUID);
    expect(String(orderId)).toBe(String(customerId));
  });
});
