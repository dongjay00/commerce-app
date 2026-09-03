import { ErrorCode, type PlaceOrderResultDto } from '@commerce/contracts';
import { act, renderHook } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { ADDRESS_ID, ORDER_ID } from '@/shared/api/msw/fixtures';
import { server } from '@/shared/api/msw/server';
import { MESSAGES } from '@/shared/lib/api-error';
import { usePlaceOrder } from './use-place-order';

describe('usePlaceOrder', () => {
  it('성공하면 orderId와 status를 돌려준다', async () => {
    const { result } = renderHook(() => usePlaceOrder());

    let placed: PlaceOrderResultDto | null | undefined;
    await act(async () => {
      placed = await result.current.placeOrder(ADDRESS_ID);
    });

    expect(placed).toEqual({ orderId: ORDER_ID, status: 'PAID' });
  });

  it('결제 거절도 성공이고 status가 PAYMENT_FAILED다', async () => {
    // 계획 4의 결정: 주문은 만들어졌고 번호가 있다. 화면이 status로 분기한다.
    server.use(
      http.post('/api/orders', () =>
        HttpResponse.json({ orderId: ORDER_ID, status: 'PAYMENT_FAILED' }, { status: 200 }),
      ),
    );
    const { result } = renderHook(() => usePlaceOrder());

    let placed: PlaceOrderResultDto | null | undefined;
    await act(async () => {
      placed = await result.current.placeOrder(ADDRESS_ID);
    });

    expect(placed?.status).toBe('PAYMENT_FAILED');
    // 거절은 오류가 아니다 — 빨간 문구를 띄우지 않는다.
    expect(result.current.error).toBeNull();
  });

  it('재고가 부족하면 null이고 그 문구를 담는다', async () => {
    server.use(
      http.post('/api/orders', () =>
        HttpResponse.json({ code: ErrorCode.INSUFFICIENT_STOCK, message: 'x' }, { status: 409 }),
      ),
    );
    const { result } = renderHook(() => usePlaceOrder());

    let placed: PlaceOrderResultDto | null | undefined;
    await act(async () => {
      placed = await result.current.placeOrder(ADDRESS_ID);
    });

    expect(placed).toBeNull();
    expect(result.current.error).toBe(MESSAGES[ErrorCode.INSUFFICIENT_STOCK]);
    expect(result.current.pending).toBe(false);
  });

  it('빈 장바구니면 그 문구를 담는다', async () => {
    server.use(
      http.post('/api/orders', () =>
        HttpResponse.json({ code: ErrorCode.DOMAIN_RULE_VIOLATED, message: 'x' }, { status: 422 }),
      ),
    );
    const { result } = renderHook(() => usePlaceOrder());

    await act(async () => {
      await result.current.placeOrder(ADDRESS_ID);
    });

    expect(result.current.error).toBe(MESSAGES[ErrorCode.DOMAIN_RULE_VIOLATED]);
    expect(result.current.pending).toBe(false);
  });

  it('응답이 계약 형태가 아니면 null이다', async () => {
    server.use(http.post('/api/orders', () => HttpResponse.json({ weird: true }, { status: 200 })));
    const { result } = renderHook(() => usePlaceOrder());

    let placed: PlaceOrderResultDto | null | undefined;
    await act(async () => {
      placed = await result.current.placeOrder(ADDRESS_ID);
    });

    expect(placed).toBeNull();
    expect(result.current.error).toBe(MESSAGES[ErrorCode.INTERNAL_ERROR]);
    expect(result.current.pending).toBe(false);
  });

  it('네트워크가 끊겨도 던지지 않는다', async () => {
    server.use(http.post('/api/orders', () => HttpResponse.error()));
    const { result } = renderHook(() => usePlaceOrder());

    let placed: PlaceOrderResultDto | null | undefined;
    await act(async () => {
      placed = await result.current.placeOrder(ADDRESS_ID);
    });

    expect(placed).toBeNull();
    expect(result.current.error).toBe(MESSAGES[ErrorCode.INTERNAL_ERROR]);
    expect(result.current.pending).toBe(false);
  });
});
