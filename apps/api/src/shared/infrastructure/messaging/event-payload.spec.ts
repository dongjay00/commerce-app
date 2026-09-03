import { describe, expect, it } from 'vitest';
import { requireBoolean, requireString } from './event-payload';

const EVENT = 'ordering.OrderPaid';

describe('requireString', () => {
  it('문자열을 꺼낸다', () => {
    expect(requireString({ orderId: 'abc' }, 'orderId', EVENT)).toBe('abc');
  });

  it('키가 없으면 이벤트 이름과 키를 담아 던진다', () => {
    // 릴레이의 last_error에 정확한 이유가 남아야 한다.
    expect(() => requireString({}, 'orderId', EVENT)).toThrow(/ordering\.OrderPaid.*orderId/);
  });

  it('타입이 다르면 던진다', () => {
    expect(() => requireString({ orderId: 42 }, 'orderId', EVENT)).toThrow();
  });

  it('빈 문자열도 던진다', () => {
    // ''는 유효한 식별자가 아니고, 통과시키면 값 객체가 대신 던져 원인이 흐려진다.
    expect(() => requireString({ orderId: '' }, 'orderId', EVENT)).toThrow();
  });
});

describe('requireBoolean', () => {
  it('불린을 꺼낸다', () => {
    expect(requireBoolean({ wasPaid: false }, 'wasPaid', EVENT)).toBe(false);
  });

  it('키가 없으면 던진다', () => {
    expect(() => requireBoolean({}, 'wasPaid', EVENT)).toThrow(/wasPaid/);
  });

  it('문자열 "true"는 불린이 아니다', () => {
    // JsonB에서 온 값이라 이런 형태가 실제로 올 수 있다.
    expect(() => requireBoolean({ wasPaid: 'true' }, 'wasPaid', EVENT)).toThrow();
  });
});
