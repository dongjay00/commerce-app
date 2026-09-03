import type { ProductDto } from '@commerce/contracts';
import Link from 'next/link';
import { formatMoney } from '@/shared/lib/format-money';

/**
 * 목록에 쓰는 카드. **최저가를 계산해 보여준다** — 이것은 표현 로직이다.
 * 주문 금액 같은 진짜 계산은 서버가 하고 API가 계산된 값을 내려준다(스펙 §8.1).
 */
export function ProductCard({ product }: { product: ProductDto }) {
  const cheapest = product.skus.reduce((min, sku) =>
    BigInt(sku.price.amount) < BigInt(min.price.amount) ? sku : min,
  );

  return (
    <article>
      <h3>
        <Link href={`/products/${product.id}`}>{product.name}</Link>
      </h3>
      <p>{formatMoney(cheapest.price)}부터</p>
    </article>
  );
}
