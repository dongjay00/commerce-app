import type { ProductDto } from '@commerce/contracts';
import { ProductCard } from '@/entities/product';

/**
 * 빈 배열에 안내 문구를 내는 이유: 아무것도 그리지 않으면 사용자는 상품이 없는 것인지
 * 아직 불러오는 중인지 구별할 수 없다.
 */
export function ProductGrid({ products }: { products: ProductDto[] }) {
  if (products.length === 0) {
    return <p>판매 중인 상품이 없습니다.</p>;
  }
  return (
    <ul>
      {products.map((product) => (
        <li key={product.id}>
          <ProductCard product={product} />
        </li>
      ))}
    </ul>
  );
}
