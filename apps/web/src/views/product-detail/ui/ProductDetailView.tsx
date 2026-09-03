'use client';

import type { ProductDto } from '@commerce/contracts';
import { AddToCartButton } from '@/features/cart-items';
import { formatMoney } from '@/shared/lib/format-money';

/**
 * SKU마다 담기 버튼을 둔다. 옵션 선택 UI(드롭다운)를 만들지 않는 이유: SKU가
 * 코드 문자열 하나뿐이라 고를 축이 없다. 옵션 축(색·사이즈)이 생기면 그때 만든다.
 */
export function ProductDetailView({
  product,
  onAdded,
}: {
  product: ProductDto;
  onAdded?: () => void;
}) {
  return (
    <>
      <h1>{product.name}</h1>
      <ul>
        {product.skus.map((sku) => (
          <li key={sku.id}>
            <h2>{sku.code}</h2>
            <p>{formatMoney(sku.price)}</p>
            <AddToCartButton skuId={sku.id} onAdded={onAdded} />
          </li>
        ))}
      </ul>
    </>
  );
}
