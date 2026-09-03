import type { ProductView, SearchCriteria } from '../../out/product.query';

export interface SearchProductsQuery {
  execute(criteria: SearchCriteria): Promise<ProductView[]>;
}

export const SEARCH_PRODUCTS_QUERY = Symbol('SearchProductsQuery');
