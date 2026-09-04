import type { ProductDto } from '@commerce/contracts';
import { ProductGrid } from '@/widgets/product-grid';

export function ProductListView({ products }: { products: ProductDto[] }) {
  return (
    <>
      <h1>상품</h1>
      <ProductGrid products={products} />
    </>
  );
}
