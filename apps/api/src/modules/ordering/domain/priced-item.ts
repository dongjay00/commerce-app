import type { SkuId } from '../../../shared/kernel/identifiers';
import type { Money } from '../../../shared/kernel/money';

/**
 * `CatalogPriceProvider` ACL이 돌려주는 타입. **Catalog의 `Product`가 아니다.**
 *
 * Ordering이 Catalog의 애그리거트를 들면 상품 가격이 바뀔 때 과거 주문 금액이 따라
 * 바뀌고(스펙 §5.3), Ordering의 도메인 테스트가 Catalog 전체를 끌고 온다.
 * ACL이 값만 복사해 이 타입으로 바꾼다.
 */
export interface PricedItem {
  readonly skuId: SkuId;
  readonly nameSnapshot: string;
  readonly unitPrice: Money;
}
