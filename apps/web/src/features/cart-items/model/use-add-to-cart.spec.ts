import { ErrorCode } from '@commerce/contracts';
import { act, renderHook, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { SKU_ID } from '@/shared/api/msw/fixtures';
import { server } from '@/shared/api/msw/server';
import { MESSAGES } from '@/shared/lib/api-error';
import { useAddToCart } from './use-add-to-cart';

describe('useAddToCart', () => {
  it('처음에는 대기 중도 아니고 에러도 없다', () => {
    const { result } = renderHook(() => useAddToCart());

    expect(result.current.pending).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('성공하면 true를 돌려준다', async () => {
    const { result } = renderHook(() => useAddToCart());

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.addToCart(SKU_ID, 1);
    });

    expect(ok).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('요청 중에는 pending이 켜지고 끝나면 꺼진다', async () => {
    const { result } = renderHook(() => useAddToCart());

    let resolveRequest: (() => void) | undefined;
    server.use(
      http.post('/api/cart/items', async () => {
        await new Promise<void>((resolve) => {
          resolveRequest = resolve;
        });
        return new HttpResponse(null, { status: 204 });
      }),
    );

    let promise: Promise<boolean> | undefined;
    act(() => {
      promise = result.current.addToCart(SKU_ID, 1);
    });
    await waitFor(() => expect(result.current.pending).toBe(true));

    await act(async () => {
      resolveRequest?.();
      await promise;
    });

    expect(result.current.pending).toBe(false);
  });

  it('실패하면 false를 돌려주고 코드에 맞는 문구를 담는다', async () => {
    server.use(
      http.post('/api/cart/items', () =>
        HttpResponse.json({ code: ErrorCode.NOT_FOUND, message: 'x' }, { status: 404 }),
      ),
    );
    const { result } = renderHook(() => useAddToCart());

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.addToCart(SKU_ID, 1);
    });

    expect(ok).toBe(false);
    expect(result.current.error).toBe(MESSAGES[ErrorCode.NOT_FOUND]);
    expect(result.current.pending).toBe(false);
  });

  it('다시 시도하면 이전 에러가 지워진다', async () => {
    server.use(
      http.post('/api/cart/items', () =>
        HttpResponse.json({ code: ErrorCode.NOT_FOUND, message: 'x' }, { status: 404 }),
      ),
    );
    const { result } = renderHook(() => useAddToCart());
    await act(async () => {
      await result.current.addToCart(SKU_ID, 1);
    });
    expect(result.current.error).not.toBeNull();

    server.resetHandlers();
    await act(async () => {
      await result.current.addToCart(SKU_ID, 1);
    });

    expect(result.current.error).toBeNull();
  });

  it('네트워크가 끊겨도 던지지 않는다', async () => {
    server.use(http.post('/api/cart/items', () => HttpResponse.error()));
    const { result } = renderHook(() => useAddToCart());

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.addToCart(SKU_ID, 1);
    });

    expect(ok).toBe(false);
    expect(result.current.error).toBe(MESSAGES[ErrorCode.INTERNAL_ERROR]);
  });

  it('재고가 부족하면 그 문구를 담는다', async () => {
    // 담기 단계에서는 재고를 보지 않지만(예약은 주문 시점이다), API가 그 코드를
    // 낼 수 있는 계약이므로 화면이 분기할 수 있어야 한다.
    server.use(
      http.post('/api/cart/items', () =>
        HttpResponse.json({ code: ErrorCode.INSUFFICIENT_STOCK, message: 'x' }, { status: 409 }),
      ),
    );
    const { result } = renderHook(() => useAddToCart());

    await act(async () => {
      await result.current.addToCart(SKU_ID, 3);
    });

    expect(result.current.error).toBe(MESSAGES[ErrorCode.INSUFFICIENT_STOCK]);
  });

  it('본문에 skuId와 quantity를 싣는다', async () => {
    // 계약을 벗어난 본문을 보내면 MSW의 Nest 핸들러가 던지지만, BFF 핸들러는
    // 검사하지 않는다 — 그래서 이 단언이 필요하다.
    let seen: unknown = null;
    server.use(
      http.post('/api/cart/items', async ({ request }) => {
        seen = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { result } = renderHook(() => useAddToCart());

    await act(async () => {
      await result.current.addToCart(SKU_ID, 3);
    });

    expect(seen).toEqual({ skuId: SKU_ID, quantity: 3 });
  });
});
