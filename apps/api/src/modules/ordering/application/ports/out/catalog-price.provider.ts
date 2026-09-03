import type { SkuId } from '../../../../../shared/kernel/identifiers';
import type { PricedItem } from '../../../domain/priced-item';

/**
 * Catalog로 나가는 ACL. **`Product`를 받지 않고 값만 받는다**(스펙 §5.3).
 *
 * 없는 SKU는 **결과에서 빠진다** — 던지지 않는다. 호출자(`PlaceOrderService`)가
 * 요청한 SKU 수와 결과 수를 비교해 무엇이 빠졌는지 판단한다. 던지면 "어느 SKU가
 * 없는지"를 예외 메시지에서 파싱해야 한다.
 */
export interface CatalogPriceProvider {
  findPrices(skuIds: readonly SkuId[]): Promise<PricedItem[]>;
}

export const CATALOG_PRICE_PROVIDER = Symbol('CatalogPriceProvider');
