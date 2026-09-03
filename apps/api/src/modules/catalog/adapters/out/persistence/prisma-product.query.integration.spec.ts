import { beforeEach, describe, expect, it } from 'vitest';
import { testDb } from '../../../../../../test/setup/database';
import { ProductId, SkuId } from '../../../../../shared/kernel/identifiers';
import { Money } from '../../../../../shared/kernel/money';
import { Price } from '../../../domain/price';
import { Product, type ProductStatus } from '../../../domain/product';
import { Sku } from '../../../domain/sku';
import { FIXED_NOW, productUuid, skuUuid } from '../../../testing/catalog.fixtures';
import { PrismaProductQuery } from './prisma-product.query';
import { PrismaProductRepository } from './prisma-product.repository';

async function seed(
  suffix: string,
  name: string,
  status: ProductStatus = 'ACTIVE',
  amount = 1000n,
): Promise<void> {
  const repo = new PrismaProductRepository(await testDb());
  const sku = Sku.create({
    id: SkuId.of(skuUuid(suffix)),
    code: `CODE-${suffix}`,
    price: Price.of(Money.of(amount)),
  });
  const product =
    status === 'ACTIVE'
      ? Product.register({
          id: ProductId.of(productUuid(suffix)),
          name,
          skus: [sku],
          now: FIXED_NOW,
        })
      : Product.rehydrate({
          id: ProductId.of(productUuid(suffix)),
          name,
          status,
          skus: [sku],
          createdAt: FIXED_NOW,
        });
  await repo.save(product);
}

let query: PrismaProductQuery;

beforeEach(async () => {
  query = new PrismaProductQuery(await testDb());
});

describe('PrismaProductQuery.findById', () => {
  it('ID로 조회하면 SKU까지 함께 나온다', async () => {
    await seed('1', '티셔츠');
    const view = await query.findById(ProductId.of(productUuid('1')));
    expect(view?.name).toBe('티셔츠');
    expect(view?.skus).toHaveLength(1);
  });

  it('없는 ID는 null이다', async () => {
    expect(await query.findById(ProductId.of(productUuid('9999')))).toBeNull();
  });

  it('금액이 문자열로 나오고 큰 값의 정밀도가 보존된다', async () => {
    // Number를 거치면 Number.MAX_SAFE_INTEGER를 넘는 값에서 조용히 정밀도를 잃는다.
    await seed('2', '고가', 'ACTIVE', 9007199254740993n);
    const view = await query.findById(ProductId.of(productUuid('2')));
    expect(view?.skus[0]?.amount).toBe('9007199254740993');
  });
});

describe('PrismaProductQuery.search', () => {
  it('ARCHIVED 상품은 제외된다', async () => {
    await seed('1', '살아있음');
    await seed('2', '보관됨', 'ARCHIVED');
    const views = await query.search({ limit: 10, offset: 0 });
    expect(views.map((v) => v.name)).toEqual(['살아있음']);
  });

  it('이름 오름차순으로 정렬되고 같은 이름이면 id로 안정 정렬된다', async () => {
    await seed('3', '다');
    await seed('1', '가');
    await seed('2', '나');
    await seed('4', '가');
    const views = await query.search({ limit: 10, offset: 0 });
    expect(views.map((v) => v.name)).toEqual(['가', '가', '나', '다']);
    expect(views[0]?.id.localeCompare(views[1]?.id ?? '')).toBeLessThan(0);
  });

  it('keyword가 이름 부분 일치로 걸러내고 대소문자를 무시한다', async () => {
    await seed('1', 'Red Shirt');
    await seed('2', 'Blue Pants');
    const views = await query.search({ keyword: 'red', limit: 10, offset: 0 });
    expect(views.map((v) => v.name)).toEqual(['Red Shirt']);
  });

  it('offset과 limit이 동작한다', async () => {
    await seed('1', '가');
    await seed('2', '나');
    await seed('3', '다');
    const views = await query.search({ limit: 1, offset: 1 });
    expect(views.map((v) => v.name)).toEqual(['나']);
  });
});
