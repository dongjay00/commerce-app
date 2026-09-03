import type { ProductView } from '../../out/product.query';

export interface GetProductQuery {
  /** 없으면 `ProductNotFoundError`를 던진다 — null을 흘리지 않는다. */
  execute(command: { readonly productId: string }): Promise<ProductView>;
}

export const GET_PRODUCT_QUERY = Symbol('GetProductQuery');
