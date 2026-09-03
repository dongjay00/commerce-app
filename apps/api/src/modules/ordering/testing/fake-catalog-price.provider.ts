import type { SkuId } from '../../../shared/kernel/identifiers';
import type { Money } from '../../../shared/kernel/money';
import type { CatalogPriceProvider } from '../application/ports/out/catalog-price.provider';
import type { PricedItem } from '../domain/priced-item';

export class FakeCatalogPriceProvider implements CatalogPriceProvider {
  readonly calls: Array<readonly SkuId[]> = [];

  private readonly catalog = new Map<string, { nameSnapshot: string; unitPrice: Money }>();

  put(skuId: SkuId, nameSnapshot: string, unitPrice: Money): this {
    this.catalog.set(skuId, { nameSnapshot, unitPrice });
    return this;
  }

  async findPrices(skuIds: readonly SkuId[]): Promise<PricedItem[]> {
    this.calls.push([...skuIds]);
    // 없는 SKU는 결과에서 빠진다 — 포트의 계약이다.
    return skuIds.flatMap((skuId) => {
      const entry = this.catalog.get(skuId);
      return entry === undefined ? [] : [{ skuId, ...entry }];
    });
  }
}
