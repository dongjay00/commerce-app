import type { SkuPriceView } from '../../out/product.query';

export interface FindSkuPricesQuery {
  execute(skuIds: readonly string[]): Promise<SkuPriceView[]>;
}

export const FIND_SKU_PRICES_QUERY = Symbol('FindSkuPricesQuery');
