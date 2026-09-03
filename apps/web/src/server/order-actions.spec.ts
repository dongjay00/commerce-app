import { ErrorCode } from '@commerce/contracts';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { ADDRESS_ID, ORDER_ID } from '../shared/api/msw/fixtures';
import { server } from '../shared/api/msw/server';
import { cancelOrderAction, placeOrderAction } from './order-actions';
import { InMemoryTokenStore } from './testing/in-memory-token-store';

const BASE = process.env['API_BASE_URL'] ?? 'http://localhost:3001';
const deps = () => ({
  baseUrl: BASE,
  store: new InMemoryTokenStore({ accessToken: 'a', refreshToken: 'r' }),
});

describe('placeOrderAction', () => {
  it('결제 성공이면 orderId와 PAID를 담아 돌려준다', async () => {
    const result = await placeOrderAction({ addressId: ADDRESS_ID }, deps());

    expect(result).toEqual({ ok: true, data: { orderId: ORDER_ID, status: 'PAID' } });
  });

  it('결제 거절도 성공 응답이다 — 상태로 분기한다', async () => {
    // 계획 4의 결정: 주문은 만들어졌고 주문 번호가 있다. 4xx로 만들면 클라이언트가
    // 번호를 받지 못해 "다시 시도" 화면을 그릴 수 없다.
    server.use(
      http.post(`${BASE}/orders`, () =>
        HttpResponse.json({ orderId: ORDER_ID, status: 'PAYMENT_FAILED' }, { status: 201 }),
      ),
    );

    const result = await placeOrderAction({ addressId: ADDRESS_ID }, deps());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.status).toBe('PAYMENT_FAILED');
    }
  });

  it('재고 부족은 실패이고 code로 분기할 수 있다', async () => {
    // 예약 단계 실패는 주문이 완성되기 전이라 409로 나온다(계획 4).
    server.use(
      http.post(`${BASE}/orders`, () =>
        HttpResponse.json(
          { code: ErrorCode.INSUFFICIENT_STOCK, message: '재고가 부족합니다: 018f' },
          { status: 409 },
        ),
      ),
    );

    const result = await placeOrderAction({ addressId: ADDRESS_ID }, deps());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(ErrorCode.INSUFFICIENT_STOCK);
    }
  });

  it('빈 장바구니는 DOMAIN_RULE_VIOLATED다', async () => {
    server.use(
      http.post(`${BASE}/orders`, () =>
        HttpResponse.json({ code: ErrorCode.DOMAIN_RULE_VIOLATED, message: 'x' }, { status: 422 }),
      ),
    );

    const result = await placeOrderAction({ addressId: ADDRESS_ID }, deps());

    expect(result.ok).toBe(false);
  });

  it('응답이 계약 형태가 아니면 실패로 만든다', async () => {
    // 서버가 형태를 바꾸면 여기서 즉시 드러난다 — undefined orderId로 라우팅하는
    // 것보다 낫다. 계획 1의 `auth-actions.ts`가 같은 판단을 했다.
    server.use(
      http.post(`${BASE}/orders`, () => HttpResponse.json({ weird: true }, { status: 201 })),
    );

    const result = await placeOrderAction({ addressId: ADDRESS_ID }, deps());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(ErrorCode.INTERNAL_ERROR);
    }
  });
});

describe('cancelOrderAction', () => {
  it('취소하면 결과 상태를 담아 돌려준다', async () => {
    const result = await cancelOrderAction(ORDER_ID, deps());

    expect(result).toEqual({ ok: true, data: { status: 'REFUND_PENDING' } });
  });

  it('취소할 수 없는 주문은 ORDER_NOT_CANCELLABLE이다', async () => {
    server.use(
      http.post(`${BASE}/orders/${ORDER_ID}/cancel`, () =>
        HttpResponse.json({ code: ErrorCode.ORDER_NOT_CANCELLABLE, message: 'x' }, { status: 409 }),
      ),
    );

    const result = await cancelOrderAction(ORDER_ID, deps());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(ErrorCode.ORDER_NOT_CANCELLABLE);
    }
  });

  it('남의 주문은 FORBIDDEN이다', async () => {
    server.use(
      http.post(`${BASE}/orders/${ORDER_ID}/cancel`, () =>
        HttpResponse.json({ code: ErrorCode.FORBIDDEN, message: 'x' }, { status: 403 }),
      ),
    );

    const result = await cancelOrderAction(ORDER_ID, deps());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(ErrorCode.FORBIDDEN);
    }
  });
});
