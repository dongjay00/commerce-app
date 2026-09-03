import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { anOrderDto } from '@/shared/api/msw/fixtures';
import { OrderSummary } from './OrderSummary';

describe('OrderSummary', () => {
  it('상태·배송지·라인·총액을 보여준다', () => {
    render(<OrderSummary order={anOrderDto()} />);

    expect(screen.getByText('결제 완료')).toBeInTheDocument();
    expect(screen.getByText(/홍길동 · 010-1234-5678/)).toBeInTheDocument();
    expect(screen.getByText('티셔츠 RED-M')).toBeInTheDocument();
    expect(screen.getByText('2개')).toBeInTheDocument();
    expect(screen.getByText('총 24,000원')).toBeInTheDocument();
  });

  it('action을 주면 그 노드를 렌더한다', () => {
    render(<OrderSummary order={anOrderDto()} action={<button type="button">주문 취소</button>} />);

    expect(screen.getByRole('button', { name: '주문 취소' })).toBeInTheDocument();
  });

  it('action을 주지 않으면 아무 버튼도 없다', () => {
    render(<OrderSummary order={anOrderDto()} />);

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('line2가 null이면 주소 뒤에 아무것도 붙지 않는다', () => {
    // 그냥 넘기면 `null`이 문자열 "null"로 찍힌다 — 이 앵커가 그것을 잡는다.
    render(<OrderSummary order={anOrderDto()} />);

    expect(
      screen.getByText(/010-1234-5678\[06236\] 서울시 강남구 테헤란로 1$/),
    ).toBeInTheDocument();
  });

  it('line2가 있으면 주소 뒤에 붙는다', () => {
    const order = anOrderDto();
    render(
      <OrderSummary
        order={anOrderDto({ shippingAddress: { ...order.shippingAddress, line2: '101동 1001호' } })}
      />,
    );

    expect(screen.getByText(/서울시 강남구 테헤란로 1 101동 1001호$/)).toBeInTheDocument();
  });
});
