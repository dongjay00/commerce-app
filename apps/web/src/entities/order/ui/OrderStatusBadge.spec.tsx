import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { OrderStatusBadge } from './OrderStatusBadge';

describe('OrderStatusBadge', () => {
  it('data-status 속성과 한국어 라벨이 함께 나온다', () => {
    render(<OrderStatusBadge status="PAID" />);

    const badge = screen.getByText('결제 완료');
    expect(badge).toHaveAttribute('data-status', 'PAID');
  });
});
