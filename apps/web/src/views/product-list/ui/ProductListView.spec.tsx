import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { aProductDto, PRODUCT_ID } from '@/shared/api/msw/fixtures';
import { ProductListView } from './ProductListView';

describe('ProductListView', () => {
  it('상품마다 상세로 가는 링크가 보인다', () => {
    const products = [
      aProductDto({ name: '티셔츠' }),
      aProductDto({ id: `${PRODUCT_ID.slice(0, -1)}2`, name: '바지' }),
    ];

    render(<ProductListView products={products} />);

    expect(screen.getByRole('heading', { name: '상품' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '티셔츠' })).toHaveAttribute(
      'href',
      `/products/${PRODUCT_ID}`,
    );
    expect(screen.getByRole('link', { name: '바지' })).toBeInTheDocument();
  });

  it('상품이 없으면 제목과 안내 문구만 보인다', () => {
    render(<ProductListView products={[]} />);

    expect(screen.getByRole('heading', { name: '상품' })).toBeInTheDocument();
    expect(screen.getByText('판매 중인 상품이 없습니다.')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
