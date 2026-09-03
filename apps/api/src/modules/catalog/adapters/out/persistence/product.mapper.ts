import { ProductId, SkuId } from '../../../../../shared/kernel/identifiers';
import type { Currency } from '../../../../../shared/kernel/money';
import { Price } from '../../../domain/price';
import { Product, type ProductStatus } from '../../../domain/product';
import { Sku } from '../../../domain/sku';

export interface SkuRow {
  id: string;
  productId: string;
  code: string;
  priceAmount: bigint;
  priceCurrency: string;
}

export interface ProductRow {
  id: string;
  name: string;
  status: string;
  createdAt: Date;
  skus: SkuRow[];
}

/**
 * 저장된 행 → 애그리거트.
 *
 * 식별자도 가격도 `fromPersistence`를 쓴다. `.of`를 쓰면 깨진 행을 만났을 때
 * `DomainError`가 나가 400이 되고, 클라이언트는 자기 요청이 잘못됐다고 듣는다.
 * 실제로는 우리 데이터가 깨진 것이므로 500이 정직하다 (계획 1의 M7).
 *
 * 계획 2의 최종 리뷰가 이 규칙이 매퍼에서 절반만 지켜진 것(ID는 맞고 VO는 틀림)을
 * 잡아냈다 — 여기서는 처음부터 전부 맞춘다.
 */
export function toProductDomain(row: ProductRow): Product {
  return Product.rehydrate({
    id: ProductId.fromPersistence(row.id),
    name: row.name,
    status: row.status as ProductStatus,
    skus: row.skus.map((sku) =>
      Sku.rehydrate({
        id: SkuId.fromPersistence(sku.id),
        code: sku.code,
        price: Price.fromPersistence(sku.priceAmount, sku.priceCurrency as Currency),
      }),
    ),
    createdAt: row.createdAt,
  });
}

export function toProductRow(product: Product): Omit<ProductRow, 'skus'> {
  return {
    id: product.id,
    name: product.name,
    status: product.status,
    createdAt: product.createdAt,
  };
}

export function toSkuRows(product: Product): SkuRow[] {
  return product.skus.map((sku) => ({
    id: sku.id,
    productId: product.id,
    code: sku.code,
    // bigint를 그대로 넘긴다. Number를 거치면 Number.MAX_SAFE_INTEGER를 넘는
    // 금액에서 조용히 정밀도를 잃는다 — 계약에 9007199254740993n 케이스가 있는 이유다.
    priceAmount: sku.price.money.amount,
    priceCurrency: sku.price.money.currency,
  }));
}
