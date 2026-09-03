import { ErrorCode } from '@commerce/contracts';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { ORDER_ID } from '@/shared/api/msw/fixtures';
import { server } from '@/shared/api/msw/server';
import { CancelOrderButton } from './CancelOrderButton';

describe('CancelOrderButton', () => {
  it('누르면 확인 없이 onCancelled가 결과와 함께 불린다', async () => {
    server.use(
      http.post('/api/orders/:orderId/cancel', () =>
        HttpResponse.json({ status: 'CANCELLED' }, { status: 200 }),
      ),
    );
    const onCancelled = vi.fn();
    render(<CancelOrderButton orderId={ORDER_ID} onCancelled={onCancelled} />);

    fireEvent.click(screen.getByRole('button', { name: '주문 취소' }));

    await waitFor(() => expect(onCancelled).toHaveBeenCalledWith({ status: 'CANCELLED' }));
  });

  it('결제 후 취소면 환불 처리 중 status로 onCancelled가 불린다', async () => {
    // 기본 핸들러가 이미 REFUND_PENDING을 돌려준다.
    const onCancelled = vi.fn();
    render(<CancelOrderButton orderId={ORDER_ID} onCancelled={onCancelled} />);

    fireEvent.click(screen.getByRole('button', { name: '주문 취소' }));

    await waitFor(() => expect(onCancelled).toHaveBeenCalledWith({ status: 'REFUND_PENDING' }));
  });

  it('취소할 수 없는 주문이면 onCancelled가 불리지 않고 경고가 보인다', async () => {
    server.use(
      http.post('/api/orders/:orderId/cancel', () =>
        HttpResponse.json({ code: ErrorCode.ORDER_NOT_CANCELLABLE, message: 'x' }, { status: 409 }),
      ),
    );
    const onCancelled = vi.fn();
    render(<CancelOrderButton orderId={ORDER_ID} onCancelled={onCancelled} />);

    fireEvent.click(screen.getByRole('button', { name: '주문 취소' }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(onCancelled).not.toHaveBeenCalled();
  });
});
