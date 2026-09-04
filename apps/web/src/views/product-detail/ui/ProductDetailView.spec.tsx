import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { aProductDto } from '@/shared/api/msw/fixtures';
import { ProductDetailView } from './ProductDetailView';

describe('ProductDetailView', () => {
  it('SKU마다 담기 버튼이 하나씩 있다', () => {
    render(<ProductDetailView product={aProductDto()} />);

    expect(screen.getByRole('heading', { name: '티셔츠' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '장바구니에 담기' })).toHaveLength(2);
  });

  it('가격이 SKU별로 다르게 보인다', () => {
    // 최저가 하나만 보여주면(목록의 `ProductCard`가 그렇다) 어느 SKU를 담는지 모른다.
    render(<ProductDetailView product={aProductDto()} />);

    expect(screen.getByText('RED-M')).toBeInTheDocument();
    expect(screen.getByText('12,000원')).toBeInTheDocument();
    expect(screen.getByText('RED-L')).toBeInTheDocument();
    expect(screen.getByText('13,000원')).toBeInTheDocument();
  });

  it('담기에 성공하면 onAdded가 불린다', async () => {
    // `app/`이 이 콜백으로 `router.refresh()`를 건다 — 버튼마다 넘겨주지 않으면
    // 담은 뒤에도 헤더의 장바구니 수가 갱신되지 않는다.
    const onAdded = vi.fn();
    render(<ProductDetailView product={aProductDto()} onAdded={onAdded} />);

    const [firstButton] = screen.getAllByRole('button', { name: '장바구니에 담기' });
    if (firstButton === undefined) {
      throw new Error('담기 버튼이 없다');
    }
    fireEvent.click(firstButton);

    await waitFor(() => expect(onAdded).toHaveBeenCalledTimes(1));
  });
});
