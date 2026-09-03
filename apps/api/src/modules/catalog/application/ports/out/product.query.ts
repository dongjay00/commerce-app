import type { ProductId } from '../../../../../shared/kernel/identifiers';

export interface SkuView {
  readonly id: string;
  readonly code: string;
  readonly amount: string;
  readonly currency: string;
}

/**
 * 읽기 전용 모델. 애그리거트를 재구성하지 않고 Prisma가 직접 projection한다(스펙 §7.2).
 * `@commerce/contracts`의 DTO를 쓰지 않는 이유는 애플리케이션 계층이 와이어 계약에
 * 묶이지 않기 위해서다 — 컨트롤러가 옮긴다.
 */
export interface ProductView {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly skus: SkuView[];
}

export interface SearchCriteria {
  readonly keyword?: string;
  readonly limit: number;
  readonly offset: number;
}

/**
 * SKU 단위 가격 뷰. Ordering의 `CatalogPriceProvider` ACL이 이것을 `PricedItem`으로
 * 옮긴다 — Catalog의 `Product` 애그리거트는 경계를 넘지 않는다(스펙 §5.3).
 */
export interface SkuPriceView {
  readonly skuId: string;
  readonly productName: string;
  readonly skuCode: string;
  readonly amount: string;
  readonly currency: string;
}

export interface ProductQuery {
  findById(productId: ProductId): Promise<ProductView | null>;
  /** ACTIVE 상품만 돌려준다. 정렬은 이름 오름차순으로 고정한다. */
  search(criteria: SearchCriteria): Promise<ProductView[]>;
  /**
   * ACTIVE 상품의 SKU만 돌려준다. **없는 SKU는 결과에서 빠진다** — 던지지 않는다.
   * Ordering의 `CatalogPriceProvider` 포트가 같은 계약을 갖는다.
   *
   * 한 번의 쿼리로 전부 읽는다. SKU마다 조회하면 장바구니 20줄에 쿼리가 20개다.
   */
  findSkus(skuIds: readonly string[]): Promise<SkuPriceView[]>;
}

export const PRODUCT_QUERY = Symbol('ProductQuery');
