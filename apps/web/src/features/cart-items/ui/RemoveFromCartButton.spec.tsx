import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { SKU_ID } from '@/shared/api/msw/fixtures';
import { server } from '@/shared/api/msw/server';
import { RemoveFromCartButton } from './RemoveFromCartButton';

describe('RemoveFromCartButton', () => {
  it('누르면 성공 시 onRemoved가 불린다', async () => {
    server.use(
      http.delete('/api/cart/items/:skuId', () => new HttpResponse(null, { status: 204 })),
    );
    const onRemoved = vi.fn();
    render(<RemoveFromCartButton skuId={SKU_ID} onRemoved={onRemoved} />);

    fireEvent.click(screen.getByRole('button', { name: '빼기' }));

    await waitFor(() => expect(onRemoved).toHaveBeenCalledTimes(1));
  });

  it('실패하면 role="alert"이 보인다', async () => {
    server.use(
      http.delete('/api/cart/items/:skuId', () =>
        HttpResponse.json({ code: 'NOT_FOUND', message: 'x' }, { status: 404 }),
      ),
    );
    render(<RemoveFromCartButton skuId={SKU_ID} />);

    fireEvent.click(screen.getByRole('button', { name: '빼기' }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('요청 중에는 버튼이 disabled다', async () => {
    let resolveRequest: (() => void) | undefined;
    server.use(
      http.delete('/api/cart/items/:skuId', async () => {
        await new Promise<void>((resolve) => {
          resolveRequest = resolve;
        });
        return new HttpResponse(null, { status: 204 });
      }),
    );
    render(<RemoveFromCartButton skuId={SKU_ID} />);

    fireEvent.click(screen.getByRole('button', { name: '빼기' }));

    await waitFor(() => expect(screen.getByRole('button')).toBeDisabled());

    resolveRequest?.();
    await waitFor(() => expect(screen.getByRole('button')).not.toBeDisabled());
  });
});
