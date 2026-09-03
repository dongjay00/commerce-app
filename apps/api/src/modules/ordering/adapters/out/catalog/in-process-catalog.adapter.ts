import { Inject, Injectable } from '@nestjs/common';
import { SkuId } from '../../../../../shared/kernel/identifiers';
import { type Currency, Money } from '../../../../../shared/kernel/money';
import { FIND_SKU_PRICES_QUERY, type FindSkuPricesQuery } from '../../../../catalog';
import type { CatalogPriceProvider } from '../../../application/ports/out/catalog-price.provider';
import type { PricedItem } from '../../../domain/priced-item';

/**
 * Catalog로 나가는 ACL (스펙 §4.2). **이 파일이 Catalog를 별도 서비스로 떼어낼 때
 * 고칠 유일한 파일이다.**
 *
 * `Product` 애그리거트를 받지 않고 `SkuPriceView`(값)를 받아 `PricedItem`으로 바꾼다.
 * 그 변환이 ACL의 전부다 — 두 컨텍스트의 모델이 서로를 모르게 하는 것.
 *
 * `nameSnapshot`이 `"상품명 SKU코드"`인 이유: 상품 이름만으로는 어떤 변형을 샀는지
 * 알 수 없고, SKU 코드만으로는 무엇인지 알 수 없다. 주문 내역은 몇 달 뒤에 읽힌다.
 */
@Injectable()
export class InProcessCatalogAdapter implements CatalogPriceProvider {
  constructor(@Inject(FIND_SKU_PRICES_QUERY) private readonly skuPrices: FindSkuPricesQuery) {}

  async findPrices(skuIds: readonly SkuId[]): Promise<PricedItem[]> {
    const views = await this.skuPrices.execute([...skuIds]);
    return views.map((view) => ({
      // Catalog가 돌려준 것은 저장된 값이므로 fromPersistence다 — 사용자 입력이 아니다.
      skuId: SkuId.fromPersistence(view.skuId),
      nameSnapshot: `${view.productName} ${view.skuCode}`,
      unitPrice: Money.of(BigInt(view.amount), view.currency as Currency),
    }));
  }
}
