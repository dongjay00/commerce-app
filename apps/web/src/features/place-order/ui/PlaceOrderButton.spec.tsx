import type { PlaceOrderResultDto } from '@commerce/contracts';
import { ErrorCode } from '@commerce/contracts';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { ADDRESS_ID, ORDER_ID } from '@/shared/api/msw/fixtures';
import { server } from '@/shared/api/msw/server';
import { PlaceOrderButton } from './PlaceOrderButton';

describe('PlaceOrderButton', () => {
  it('addressId가 null이면 버튼이 disabled다', () => {
    render(<PlaceOrderButton addressId={null} onPlaced={vi.fn()} />);

    expect(screen.getByRole('button', { name: '주문하기' })).toBeDisabled();
  });

  it('누르면 onPlaced가 결과와 함께 불린다', async () => {
    const onPlaced = vi.fn();
    render(<PlaceOrderButton addressId={ADDRESS_ID} onPlaced={onPlaced} />);

    fireEvent.click(screen.getByRole('button', { name: '주문하기' }));

    await waitFor(() =>
      expect(onPlaced).toHaveBeenCalledWith({
        orderId: ORDER_ID,
        status: 'PAID',
      } satisfies PlaceOrderResultDto),
    );
  });

  it('거절이어도 onPlaced가 불린다', async () => {
    server.use(
      http.post('/api/orders', () =>
        HttpResponse.json({ orderId: ORDER_ID, status: 'PAYMENT_FAILED' }, { status: 200 }),
      ),
    );
    const onPlaced = vi.fn();
    render(<PlaceOrderButton addressId={ADDRESS_ID} onPlaced={onPlaced} />);

    fireEvent.click(screen.getByRole('button', { name: '주문하기' }));

    await waitFor(() =>
      expect(onPlaced).toHaveBeenCalledWith({ orderId: ORDER_ID, status: 'PAYMENT_FAILED' }),
    );
  });

  it('재고 부족이면 onPlaced가 불리지 않고 경고가 보인다', async () => {
    server.use(
      http.post('/api/orders', () =>
        HttpResponse.json({ code: ErrorCode.INSUFFICIENT_STOCK, message: 'x' }, { status: 409 }),
      ),
    );
    const onPlaced = vi.fn();
    render(<PlaceOrderButton addressId={ADDRESS_ID} onPlaced={onPlaced} />);

    fireEvent.click(screen.getByRole('button', { name: '주문하기' }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(onPlaced).not.toHaveBeenCalled();
  });
});
