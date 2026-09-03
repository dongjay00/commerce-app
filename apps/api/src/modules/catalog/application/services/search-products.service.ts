import type { SearchProductsQuery } from '../ports/in/queries/search-products.query';
import type { ProductQuery, ProductView, SearchCriteria } from '../ports/out/product.query';

export class SearchProductsService implements SearchProductsQuery {
  constructor(private readonly query: ProductQuery) {}

  async execute(criteria: SearchCriteria): Promise<ProductView[]> {
    return this.query.search(criteria);
  }
}
