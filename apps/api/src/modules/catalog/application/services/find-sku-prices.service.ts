import type { FindSkuPricesQuery } from '../ports/in/queries/find-sku-prices.query';
import type { ProductQuery, SkuPriceView } from '../ports/out/product.query';

/**
 * SKU 가격 조회. 아웃바운드 포트에 그대로 위임한다.
 *
 * 얇지만 인바운드 포트가 있어야 `catalog/index.ts`가 아웃바운드 포트(`ProductQuery`)를
 * 내보내지 않고도 조회를 열 수 있다 — 아웃바운드를 내보내면 다른 모듈이 Catalog의
 * 저장 구조에 묶인다.
 */
export class FindSkuPricesService implements FindSkuPricesQuery {
  constructor(private readonly products: ProductQuery) {}

  async execute(skuIds: readonly string[]): Promise<SkuPriceView[]> {
    if (skuIds.length === 0) {
      return [];
    }
    return this.products.findSkus(skuIds);
  }
}
