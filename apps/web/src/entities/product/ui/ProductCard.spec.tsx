import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { aProductDto, KRW } from '@/shared/api/msw/fixtures';
import { ProductCard } from './ProductCard';

describe('ProductCard', () => {
  it('이름과 상세 링크를 보여준다', () => {
    const product = aProductDto();
    render(<ProductCard product={product} />);

    expect(screen.getByRole('link', { name: '티셔츠' })).toHaveAttribute(
      'href',
      `/products/${product.id}`,
    );
  });

  it('가장 싼 SKU의 가격을 보여준다', () => {
    // 12000과 13000 중 12000. bigint 비교라 문자열 정렬 함정을 피한다 —
    // '9000' > '13000'이 문자열로는 참이다.
    render(
      <ProductCard
        product={aProductDto({
          skus: [
            { id: 'a', code: 'A', price: KRW('13000') },
            { id: 'b', code: 'B', price: KRW('9000') },
          ] as never,
        })}
      />,
    );

    expect(screen.getByText('9,000원부터')).toBeInTheDocument();
  });
});
