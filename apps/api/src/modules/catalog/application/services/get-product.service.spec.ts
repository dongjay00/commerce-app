import { describe, expect, it } from 'vitest';
import { ProductId, SkuId } from '../../../../shared/kernel/identifiers';
import { Money } from '../../../../shared/kernel/money';
import { ProductNotFoundError } from '../../domain/catalog.errors';
import { Price } from '../../domain/price';
import { Product } from '../../domain/product';
import { Sku } from '../../domain/sku';
import { FIXED_NOW, productUuid, skuUuid } from '../../testing/catalog.fixtures';
import { InMemoryProductQuery } from '../../testing/in-memory-product.query';
import { InMemoryProductRepository } from '../../testing/in-memory-product.repository';
import { GetProductService } from './get-product.service';
import { SearchProductsService } from './search-products.service';

function product(suffix: string, name: string, status: 'ACTIVE' | 'ARCHIVED' = 'ACTIVE'): Product {
  const sku = Sku.create({
    id: SkuId.of(skuUuid(suffix)),
    code: `CODE-${suffix}`,
    price: Price.of(Money.of(1000n)),
  });
  return status === 'ACTIVE'
    ? Product.register({ id: ProductId.of(productUuid(suffix)), name, skus: [sku], now: FIXED_NOW })
    : Product.rehydrate({
        id: ProductId.of(productUuid(suffix)),
        name,
        status,
        skus: [sku],
        createdAt: FIXED_NOW,
      });
}

async function build(...seed: Product[]) {
  const products = new InMemoryProductRepository();
  for (const p of seed) await products.save(p);
  const query = new InMemoryProductQuery(products);
  return { get: new GetProductService(query), search: new SearchProductsService(query) };
}

describe('GetProductService', () => {
  it('조회 포트의 결과를 그대로 돌려준다', async () => {
    const { get } = await build(product('1', '티셔츠'));
    const view = await get.execute({ productId: productUuid('1') });
    expect(view.name).toBe('티셔츠');
    expect(view.skus[0]?.amount).toBe('1000'); // JSON에 bigint가 없으므로 문자열이다
  });

  it('없는 상품이면 ProductNotFoundError다', async () => {
    const { get } = await build();
    await expect(get.execute({ productId: productUuid('9999') })).rejects.toThrow(
      ProductNotFoundError,
    );
  });
});

describe('SearchProductsService', () => {
  it('ARCHIVED 상품을 제외한다', async () => {
    const { search } = await build(product('1', '살아있음'), product('2', '보관됨', 'ARCHIVED'));
    const views = await search.execute({ limit: 10, offset: 0 });
    expect(views.map((v) => v.name)).toEqual(['살아있음']);
  });

  it('이름 오름차순으로 정렬한다', async () => {
    const { search } = await build(product('1', '다'), product('2', '가'), product('3', '나'));
    const views = await search.execute({ limit: 10, offset: 0 });
    expect(views.map((v) => v.name)).toEqual(['가', '나', '다']);
  });

  it('keyword가 이름 부분 일치로 걸러낸다', async () => {
    const { search } = await build(product('1', '빨간 티셔츠'), product('2', '파란 바지'));
    const views = await search.execute({ keyword: '티셔츠', limit: 10, offset: 0 });
    expect(views.map((v) => v.name)).toEqual(['빨간 티셔츠']);
  });

  it('offset과 limit이 동작한다', async () => {
    const { search } = await build(product('1', '가'), product('2', '나'), product('3', '다'));
    const views = await search.execute({ limit: 1, offset: 1 });
    expect(views.map((v) => v.name)).toEqual(['나']);
  });
});
