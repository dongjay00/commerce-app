import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { anOrderDto } from '@/shared/api/msw/fixtures';
import { OrderDetailView } from './OrderDetailView';

describe('OrderDetailView', () => {
  it('PAID면 취소 버튼이 보인다', () => {
    render(<OrderDetailView order={anOrderDto({ status: 'PAID' })} onCancelled={vi.fn()} />);

    expect(screen.getByRole('button', { name: '주문 취소' })).toBeInTheDocument();
  });

  it('REFUNDED면 취소 버튼이 보이지 않는다', () => {
    render(<OrderDetailView order={anOrderDto({ status: 'REFUNDED' })} onCancelled={vi.fn()} />);

    expect(screen.getByText('환불 완료')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '주문 취소' })).not.toBeInTheDocument();
  });

  it('PAYMENT_FAILED면 거절 문구가 보인다', () => {
    // 이 문구는 스펙 §9.10의 E2E 시나리오가 그대로 찾는 문자열이다.
    render(
      <OrderDetailView order={anOrderDto({ status: 'PAYMENT_FAILED' })} onCancelled={vi.fn()} />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('결제가 거절되었습니다.');
  });

  it('PAID면 거절 문구가 없다', () => {
    render(<OrderDetailView order={anOrderDto({ status: 'PAID' })} onCancelled={vi.fn()} />);

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
