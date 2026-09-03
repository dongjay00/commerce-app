import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ADDRESS_ID, aCartDto, anAddressDto, ORDER_ID, SKU_ID_2 } from '@/shared/api/msw/fixtures';
import { CartView } from './CartView';

describe('CartView', () => {
  it('라인과 총액이 보이고 줄마다 빼기 버튼이 있다', () => {
    render(<CartView cart={aCartDto()} addresses={[anAddressDto()]} onPlaced={vi.fn()} />);

    expect(screen.getByText('티셔츠 RED-M')).toBeInTheDocument();
    expect(screen.getByText('2개')).toBeInTheDocument();
    expect(screen.getByText('총 24,000원')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '빼기' })).toHaveLength(1);
  });

  it('비어 있으면 안내만 보이고 주문할 수 없다', () => {
    render(
      <CartView
        cart={aCartDto({ lines: [], total: { amount: '0', currency: 'KRW' } })}
        addresses={[anAddressDto()]}
        onPlaced={vi.fn()}
      />,
    );

    expect(screen.getByText('장바구니가 비어 있습니다.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '주문하기' })).not.toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  });

  it('판매가 중지된 SKU가 있으면 경고가 보인다', () => {
    render(
      <CartView
        cart={aCartDto({ unavailableSkuIds: [SKU_ID_2] })}
        addresses={[anAddressDto()]}
        onPlaced={vi.fn()}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      '판매가 중지된 상품 1개는 주문에서 제외됩니다.',
    );
  });

  it('판매가 중지된 SKU가 없으면 경고가 없다', () => {
    render(<CartView cart={aCartDto()} addresses={[anAddressDto()]} onPlaced={vi.fn()} />);

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('기본 배송지가 처음부터 선택돼 있다', () => {
    render(<CartView cart={aCartDto()} addresses={[anAddressDto()]} onPlaced={vi.fn()} />);

    expect(screen.getByRole('radio')).toBeChecked();
  });

  it('기본 배송지가 목록 첫 줄이 아니어도 그것이 선택된다', () => {
    // 주소가 하나뿐인 픽스처로는 `addresses[0]`과 기본 배송지가 같은 값이라
    // 이 판단이 도는지 알 수 없다. 순서를 어긋나게 해야 판별력이 생긴다.
    const other = anAddressDto({
      id: `${ADDRESS_ID.slice(0, -1)}2`,
      recipient: '김철수',
      isDefault: false,
    });

    render(<CartView cart={aCartDto()} addresses={[other, anAddressDto()]} onPlaced={vi.fn()} />);

    expect(screen.getByRole('radio', { name: /홍길동/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /김철수/ })).not.toBeChecked();
  });

  it('다른 배송지를 고르면 그것이 선택된다', () => {
    // `onSelect`가 끊겨도 기본 배송지가 남아 주문은 성공하므로 E2E도 이것을 잡지 못한다.
    const other = anAddressDto({
      id: `${ADDRESS_ID.slice(0, -1)}2`,
      recipient: '김철수',
      isDefault: false,
    });

    render(<CartView cart={aCartDto()} addresses={[anAddressDto(), other]} onPlaced={vi.fn()} />);

    fireEvent.click(screen.getByRole('radio', { name: /김철수/ }));

    expect(screen.getByRole('radio', { name: /김철수/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /홍길동/ })).not.toBeChecked();
  });

  it('주문하기를 누르면 onPlaced가 결과와 함께 불린다', async () => {
    // `app/cart/cart-client.tsx`의 `router.push('/orders/{id}')`로 가는 유일한 선이다.
    // 끊기면 결제까지 끝낸 사용자가 장바구니에 남는다(스펙 §9.10).
    const onPlaced = vi.fn();
    render(<CartView cart={aCartDto()} addresses={[anAddressDto()]} onPlaced={onPlaced} />);

    fireEvent.click(screen.getByRole('button', { name: '주문하기' }));

    await waitFor(() =>
      expect(onPlaced).toHaveBeenCalledWith({ orderId: ORDER_ID, status: 'PAID' }),
    );
  });

  it('줄을 빼면 onChanged가 불린다', async () => {
    const onChanged = vi.fn();
    render(
      <CartView
        cart={aCartDto()}
        addresses={[anAddressDto()]}
        onPlaced={vi.fn()}
        onChanged={onChanged}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '빼기' }));

    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  });

  it('배송지가 없으면 주문 버튼이 disabled다', () => {
    render(<CartView cart={aCartDto()} addresses={[]} onPlaced={vi.fn()} />);

    expect(screen.getByRole('button', { name: '주문하기' })).toBeDisabled();
  });
});
