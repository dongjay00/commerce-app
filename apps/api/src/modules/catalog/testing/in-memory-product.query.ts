import type { ProductId } from '../../../shared/kernel/identifiers';
import type {
  ProductQuery,
  ProductView,
  SearchCriteria,
} from '../application/ports/out/product.query';
import type { Product } from '../domain/product';
import type { InMemoryProductRepository } from './in-memory-product.repository';

export function toProductView(product: Product): ProductView {
  return {
    id: product.id,
    name: product.name,
    status: product.status,
    skus: product.skus.map((sku) => ({
      id: sku.id,
      code: sku.code,
      // JSON에 bigint가 없다. 문자열로 옮긴다.
      amount: sku.price.money.amount.toString(),
      currency: sku.price.money.currency,
    })),
  };
}

/**
 * 단위 테스트용 ProductQuery. 리포지토리를 감싸 읽기 모델로 옮긴다.
 * `search`는 Prisma 어댑터와 같은 규칙을 따른다 — ACTIVE만, 이름 오름차순.
 */
export class InMemoryProductQuery implements ProductQuery {
  constructor(private readonly products: InMemoryProductRepository) {}

  async findById(productId: ProductId): Promise<ProductView | null> {
    const product = await this.products.findById(productId);
    return product === null ? null : toProductView(product);
  }

  async search(criteria: SearchCriteria): Promise<ProductView[]> {
    const all = await this.products.findAll();
    return all
      .filter((product) => product.status === 'ACTIVE')
      .filter((product) =>
        criteria.keyword === undefined
          ? true
          : product.name.toLowerCase().includes(criteria.keyword.toLowerCase()),
      )
      .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id))
      .slice(criteria.offset, criteria.offset + criteria.limit)
      .map(toProductView);
  }
}
