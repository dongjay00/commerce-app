import type { ProductId } from '../../../../../shared/kernel/identifiers';
import type { TransactionContext } from '../../../../../shared/kernel/ports/transaction-manager';
import type { Product } from '../../../domain/product';

/**
 * 쓰기 전용 포트 — 애그리거트를 반환한다(스펙 §7.2).
 * `save`는 SKU 목록까지 함께 저장한다. `Sku`는 애그리거트 안이라 따로 저장할 방법이
 * 없어야 하고, 어댑터는 애그리거트에서 사라진 SKU 행을 지우는 것까지 책임진다.
 */
export interface ProductRepository {
  findById(id: ProductId, tx?: TransactionContext): Promise<Product | null>;
  save(product: Product, tx?: TransactionContext): Promise<void>;
}

export const PRODUCT_REPOSITORY = Symbol('ProductRepository');
