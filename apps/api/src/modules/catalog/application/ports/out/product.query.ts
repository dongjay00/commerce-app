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

export interface ProductQuery {
  findById(productId: ProductId): Promise<ProductView | null>;
  /** ACTIVE 상품만 돌려준다. 정렬은 이름 오름차순으로 고정한다. */
  search(criteria: SearchCriteria): Promise<ProductView[]>;
}

export const PRODUCT_QUERY = Symbol('ProductQuery');
