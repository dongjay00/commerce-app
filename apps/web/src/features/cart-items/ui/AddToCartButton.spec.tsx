import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { SKU_ID } from '@/shared/api/msw/fixtures';
import { server } from '@/shared/api/msw/server';
import { AddToCartButton } from './AddToCartButton';

describe('AddToCartButton', () => {
  it('수량을 3으로 바꾸고 누르면 그 값이 요청에 실린다', async () => {
    let requestBody: unknown;
    server.use(
      http.post('/api/cart/items', async ({ request }) => {
        requestBody = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
    );
    render(<AddToCartButton skuId={SKU_ID} />);

    fireEvent.change(screen.getByLabelText('수량'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: '장바구니에 담기' }));

    await waitFor(() => expect(requestBody).toEqual({ skuId: SKU_ID, quantity: 3 }));
  });

  it('실패하면 role="alert"이 보인다', async () => {
    server.use(
      http.post('/api/cart/items', () =>
        HttpResponse.json({ code: 'NOT_FOUND', message: 'x' }, { status: 404 }),
      ),
    );
    render(<AddToCartButton skuId={SKU_ID} />);

    fireEvent.click(screen.getByRole('button', { name: '장바구니에 담기' }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('성공하면 onAdded가 불린다', async () => {
    server.use(http.post('/api/cart/items', () => new HttpResponse(null, { status: 204 })));
    const onAdded = vi.fn();
    render(<AddToCartButton skuId={SKU_ID} onAdded={onAdded} />);

    fireEvent.click(screen.getByRole('button', { name: '장바구니에 담기' }));

    await waitFor(() => expect(onAdded).toHaveBeenCalledTimes(1));
  });

  it('요청 중에는 버튼이 disabled다', async () => {
    let resolveRequest: (() => void) | undefined;
    server.use(
      http.post('/api/cart/items', async () => {
        await new Promise<void>((resolve) => {
          resolveRequest = resolve;
        });
        return new HttpResponse(null, { status: 204 });
      }),
    );
    render(<AddToCartButton skuId={SKU_ID} />);

    fireEvent.click(screen.getByRole('button', { name: '장바구니에 담기' }));

    await waitFor(() => expect(screen.getByRole('button')).toBeDisabled());

    resolveRequest?.();
    await waitFor(() => expect(screen.getByRole('button')).not.toBeDisabled());
  });
});
