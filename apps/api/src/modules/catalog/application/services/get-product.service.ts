import { ProductId } from '../../../../shared/kernel/identifiers';
import { ProductNotFoundError } from '../../domain/catalog.errors';
import type { GetProductQuery } from '../ports/in/queries/get-product.query';
import type { ProductQuery, ProductView } from '../ports/out/product.query';

/**
 * 조회는 애그리거트를 거치지 않는다 (스펙 §7.2). 조회 포트가 Prisma projection으로
 * 바로 읽고, 이 서비스는 "없으면 404"라는 정책만 얹는다.
 */
export class GetProductService implements GetProductQuery {
  constructor(private readonly query: ProductQuery) {}

  async execute(command: { productId: string }): Promise<ProductView> {
    const productId = ProductId.of(command.productId);
    const view = await this.query.findById(productId);
    if (view === null) {
      throw new ProductNotFoundError(productId);
    }
    return view;
  }
}
