import type { PlaceOrderResultDto } from '@commerce/contracts';
import { ErrorCode } from '@commerce/contracts';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { ADDRESS_ID, ORDER_ID } from '@/shared/api/msw/fixtures';
import { server } from '@/shared/api/msw/server';
import { MESSAGES } from '@/shared/lib/api-error';
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

  /**
   * 서버는 첫 트랜잭션에서 장바구니를 비운 뒤 재고를 예약한다. 그래서 409가 온
   * 시점에 장바구니는 이미 비어 있고, 화면은 그것을 다시 읽어야 한다.
   * 이것 없이는 사용자가 사라진 라인과 옛 총액을 계속 본다(최종 리뷰 I2).
   */
  it('실패하면 onFailed가 이유와 함께 불린다 — 서버 장바구니는 이미 비었다', async () => {
    server.use(
      http.post('/api/orders', () =>
        HttpResponse.json({ code: ErrorCode.INSUFFICIENT_STOCK, message: 'x' }, { status: 409 }),
      ),
    );
    const onFailed = vi.fn();
    render(<PlaceOrderButton addressId={ADDRESS_ID} onPlaced={vi.fn()} onFailed={onFailed} />);

    fireEvent.click(screen.getByRole('button', { name: '주문하기' }));

    // 이유를 함께 넘긴다 — 부모가 새로고침한 뒤에도 같은 문구를 그릴 수 있어야 한다.
    await waitFor(() =>
      expect(onFailed).toHaveBeenCalledWith(MESSAGES[ErrorCode.INSUFFICIENT_STOCK]),
    );
    expect(onFailed).toHaveBeenCalledTimes(1);
  });

  it('성공하면 onFailed는 불리지 않는다', async () => {
    const onFailed = vi.fn();
    const onPlaced = vi.fn();
    render(<PlaceOrderButton addressId={ADDRESS_ID} onPlaced={onPlaced} onFailed={onFailed} />);

    fireEvent.click(screen.getByRole('button', { name: '주문하기' }));

    await waitFor(() => expect(onPlaced).toHaveBeenCalledTimes(1));
    expect(onFailed).not.toHaveBeenCalled();
  });
});
