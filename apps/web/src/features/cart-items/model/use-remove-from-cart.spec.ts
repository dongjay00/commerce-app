import { ErrorCode } from '@commerce/contracts';
import { act, renderHook, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { SKU_ID } from '@/shared/api/msw/fixtures';
import { server } from '@/shared/api/msw/server';
import { MESSAGES } from '@/shared/lib/api-error';
import { useRemoveFromCart } from './use-remove-from-cart';

describe('useRemoveFromCart', () => {
  it('처음에는 대기 중도 아니고 에러도 없다', () => {
    const { result } = renderHook(() => useRemoveFromCart());

    expect(result.current.pending).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('성공하면 true를 돌려준다', async () => {
    const { result } = renderHook(() => useRemoveFromCart());

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.removeFromCart(SKU_ID);
    });

    expect(ok).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('요청 중에는 pending이 켜지고 끝나면 꺼진다', async () => {
    const { result } = renderHook(() => useRemoveFromCart());

    let resolveRequest: (() => void) | undefined;
    server.use(
      http.delete('/api/cart/items/:skuId', async () => {
        await new Promise<void>((resolve) => {
          resolveRequest = resolve;
        });
        return new HttpResponse(null, { status: 204 });
      }),
    );

    let promise: Promise<boolean> | undefined;
    act(() => {
      promise = result.current.removeFromCart(SKU_ID);
    });
    await waitFor(() => expect(result.current.pending).toBe(true));

    await act(async () => {
      resolveRequest?.();
      await promise;
    });

    expect(result.current.pending).toBe(false);
  });

  it('없는 줄이면 false를 돌려주고 NOT_FOUND 문구를 담는다', async () => {
    server.use(
      http.delete('/api/cart/items/:skuId', () =>
        HttpResponse.json({ code: ErrorCode.NOT_FOUND, message: 'x' }, { status: 404 }),
      ),
    );
    const { result } = renderHook(() => useRemoveFromCart());

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.removeFromCart(SKU_ID);
    });

    expect(ok).toBe(false);
    expect(result.current.error).toBe(MESSAGES[ErrorCode.NOT_FOUND]);
    expect(result.current.pending).toBe(false);
  });

  it('다시 시도하면 이전 에러가 지워진다', async () => {
    server.use(
      http.delete('/api/cart/items/:skuId', () =>
        HttpResponse.json({ code: ErrorCode.NOT_FOUND, message: 'x' }, { status: 404 }),
      ),
    );
    const { result } = renderHook(() => useRemoveFromCart());
    await act(async () => {
      await result.current.removeFromCart(SKU_ID);
    });
    expect(result.current.error).not.toBeNull();

    server.resetHandlers();
    await act(async () => {
      await result.current.removeFromCart(SKU_ID);
    });

    expect(result.current.error).toBeNull();
  });

  it('네트워크가 끊겨도 던지지 않는다', async () => {
    server.use(http.delete('/api/cart/items/:skuId', () => HttpResponse.error()));
    const { result } = renderHook(() => useRemoveFromCart());

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.removeFromCart(SKU_ID);
    });

    expect(ok).toBe(false);
    expect(result.current.error).toBe(MESSAGES[ErrorCode.INTERNAL_ERROR]);
  });
});
