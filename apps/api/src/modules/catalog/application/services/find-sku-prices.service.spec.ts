import { describe, expect, it } from 'vitest';
import { aProduct, skuUuid } from '../../testing/catalog.fixtures';
import { InMemoryProductQuery } from '../../testing/in-memory-product.query';
import { InMemoryProductRepository } from '../../testing/in-memory-product.repository';
import { FindSkuPricesService } from './find-sku-prices.service';

async function build() {
  const products = new InMemoryProductRepository();
  const product = aProduct('1');
  await products.save(product);
  return {
    service: new FindSkuPricesService(new InMemoryProductQuery(products)),
    skuIds: product.skus.map((sku) => sku.id as string),
    productName: product.name,
  };
}

describe('FindSkuPricesService', () => {
  it('SKU 가격과 상품 이름을 함께 돌려준다', async () => {
    const { service, skuIds, productName } = await build();

    const found = await service.execute([skuIds[0] as string]);

    expect(found).toHaveLength(1);
    expect(found[0]?.productName).toBe(productName);
    expect(found[0]?.skuId).toBe(skuIds[0]);
    expect(found[0]?.amount).toMatch(/^\d+$/);
  });

  it('없는 SKU는 결과에서 빠진다 — 던지지 않는다', async () => {
    // 포트의 계약이다. 호출자가 요청 수와 결과 수를 비교해 무엇이 빠졌는지 판단한다.
    const { service, skuIds } = await build();

    const found = await service.execute([skuIds[0] as string, skuUuid('99')]);

    expect(found.map((item) => item.skuId)).toEqual([skuIds[0]]);
  });

  it('빈 목록이면 조회하지 않고 빈 배열이다', async () => {
    // `IN ()`는 쿼리가 되지 않고, 빈 요청으로 DB를 부를 이유도 없다.
    const { service } = await build();
    expect(await service.execute([])).toEqual([]);
  });
});
