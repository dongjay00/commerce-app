import { describe, expect, it } from 'vitest';
import { SkuId } from '../../../../../shared/kernel/identifiers';
import type { FindSkuPricesQuery, SkuPriceView } from '../../../../catalog';
import { skuUuid } from '../../../testing/ordering.fixtures';
import { InProcessCatalogAdapter } from './in-process-catalog.adapter';

/** 손으로 쓴 fake. Catalog의 조회를 흉내내되 없는 SKU는 결과에서 뺀다. */
class FakeSkuPrices implements FindSkuPricesQuery {
  readonly calls: string[][] = [];

  constructor(private readonly views: SkuPriceView[]) {}

  async execute(skuIds: readonly string[]): Promise<SkuPriceView[]> {
    this.calls.push([...skuIds]);
    return this.views.filter((view) => skuIds.includes(view.skuId));
  }
}

const VIEW: SkuPriceView = {
  skuId: skuUuid('1'),
  productName: '티셔츠',
  skuCode: 'RED-M',
  amount: '12000',
  currency: 'KRW',
};

describe('InProcessCatalogAdapter', () => {
  it('nameSnapshot이 "상품명 SKU코드"다', async () => {
    // 상품 이름만으로는 어떤 변형을 샀는지 알 수 없고, 코드만으로는 무엇인지 모른다.
    const adapter = new InProcessCatalogAdapter(new FakeSkuPrices([VIEW]));

    const [item] = await adapter.findPrices([SkuId.of(skuUuid('1'))]);

    expect(item?.nameSnapshot).toBe('티셔츠 RED-M');
  });

  it('금액 문자열이 bigint Money로 복원된다', async () => {
    const adapter = new InProcessCatalogAdapter(new FakeSkuPrices([VIEW]));

    const [item] = await adapter.findPrices([SkuId.of(skuUuid('1'))]);

    expect(item?.unitPrice.amount).toBe(12_000n);
    expect(item?.unitPrice.currency).toBe('KRW');
  });

  it('없는 SKU는 결과에서 빠진다 — 던지지 않는다', async () => {
    const adapter = new InProcessCatalogAdapter(new FakeSkuPrices([VIEW]));

    const found = await adapter.findPrices([SkuId.of(skuUuid('1')), SkuId.of(skuUuid('9'))]);

    expect(found).toHaveLength(1);
  });

  it('요청한 SKU를 그대로 넘긴다', async () => {
    const query = new FakeSkuPrices([VIEW]);
    await new InProcessCatalogAdapter(query).findPrices([SkuId.of(skuUuid('1'))]);
    expect(query.calls).toEqual([[skuUuid('1')]]);
  });
});
