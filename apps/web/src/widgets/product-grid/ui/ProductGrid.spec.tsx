import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { aProductDto, PRODUCT_ID } from '@/shared/api/msw/fixtures';
import { ProductGrid } from './ProductGrid';

describe('ProductGrid', () => {
  it('상품 수만큼 항목을 보여준다', () => {
    const products = [
      aProductDto({ name: '티셔츠' }),
      aProductDto({ id: `${PRODUCT_ID.slice(0, -1)}2`, name: '바지' }),
    ];

    render(<ProductGrid products={products} />);

    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByRole('link', { name: '티셔츠' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '바지' })).toBeInTheDocument();
  });

  it('빈 배열이면 안내 문구가 보이고 목록이 없다', () => {
    // 아무것도 그리지 않으면 사용자는 상품이 없는 것인지 불러오는 중인지 알 수 없다.
    render(<ProductGrid products={[]} />);

    expect(screen.getByText('판매 중인 상품이 없습니다.')).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
  });
});
