import { type CancelOrderResultDto, ErrorCode } from '@commerce/contracts';
import { act, renderHook } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { ORDER_ID } from '@/shared/api/msw/fixtures';
import { server } from '@/shared/api/msw/server';
import { MESSAGES } from '@/shared/lib/api-error';
import { useCancelOrder } from './use-cancel-order';

describe('useCancelOrder', () => {
  it('취소되면 status를 돌려준다', async () => {
    server.use(
      http.post('/api/orders/:orderId/cancel', () =>
        HttpResponse.json({ status: 'CANCELLED' }, { status: 200 }),
      ),
    );
    const { result } = renderHook(() => useCancelOrder());

    let cancelled: CancelOrderResultDto | null | undefined;
    await act(async () => {
      cancelled = await result.current.cancelOrder(ORDER_ID);
    });

    expect(cancelled).toEqual({ status: 'CANCELLED' });
  });

  it('결제 후 취소면 환불 처리 중 status를 돌려준다', async () => {
    // 기본 핸들러가 이미 REFUND_PENDING을 돌려준다.
    const { result } = renderHook(() => useCancelOrder());

    let cancelled: CancelOrderResultDto | null | undefined;
    await act(async () => {
      cancelled = await result.current.cancelOrder(ORDER_ID);
    });

    expect(cancelled).toEqual({ status: 'REFUND_PENDING' });
    expect(result.current.error).toBeNull();
  });

  it('이미 취소된 주문이면 null이고 그 문구를 담는다', async () => {
    server.use(
      http.post('/api/orders/:orderId/cancel', () =>
        HttpResponse.json({ code: ErrorCode.ORDER_NOT_CANCELLABLE, message: 'x' }, { status: 409 }),
      ),
    );
    const { result } = renderHook(() => useCancelOrder());

    let cancelled: CancelOrderResultDto | null | undefined;
    await act(async () => {
      cancelled = await result.current.cancelOrder(ORDER_ID);
    });

    expect(cancelled).toBeNull();
    expect(result.current.error).toBe(MESSAGES[ErrorCode.ORDER_NOT_CANCELLABLE]);
    expect(result.current.pending).toBe(false);
  });

  it('남의 주문이면 null이고 그 문구를 담는다', async () => {
    server.use(
      http.post('/api/orders/:orderId/cancel', () =>
        HttpResponse.json({ code: ErrorCode.FORBIDDEN, message: 'x' }, { status: 403 }),
      ),
    );
    const { result } = renderHook(() => useCancelOrder());

    let cancelled: CancelOrderResultDto | null | undefined;
    await act(async () => {
      cancelled = await result.current.cancelOrder(ORDER_ID);
    });

    expect(cancelled).toBeNull();
    expect(result.current.error).toBe(MESSAGES[ErrorCode.FORBIDDEN]);
    expect(result.current.pending).toBe(false);
  });

  it('응답이 계약 형태가 아니면 null이다', async () => {
    server.use(
      http.post('/api/orders/:orderId/cancel', () =>
        HttpResponse.json({ weird: true }, { status: 200 }),
      ),
    );
    const { result } = renderHook(() => useCancelOrder());

    let cancelled: CancelOrderResultDto | null | undefined;
    await act(async () => {
      cancelled = await result.current.cancelOrder(ORDER_ID);
    });

    expect(cancelled).toBeNull();
    expect(result.current.error).toBe(MESSAGES[ErrorCode.INTERNAL_ERROR]);
    expect(result.current.pending).toBe(false);
  });

  it('네트워크가 끊겨도 던지지 않는다', async () => {
    server.use(http.post('/api/orders/:orderId/cancel', () => HttpResponse.error()));
    const { result } = renderHook(() => useCancelOrder());

    let cancelled: CancelOrderResultDto | null | undefined;
    await act(async () => {
      cancelled = await result.current.cancelOrder(ORDER_ID);
    });

    expect(cancelled).toBeNull();
    expect(result.current.error).toBe(MESSAGES[ErrorCode.INTERNAL_ERROR]);
    expect(result.current.pending).toBe(false);
  });
});
