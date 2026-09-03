import { describe, expect, it } from 'vitest';
import { ProductId, SkuId } from '../../../shared/kernel/identifiers';
import { Money } from '../../../shared/kernel/money';
import type { TransactionContext } from '../../../shared/kernel/ports/transaction-manager';
import type { ProductRepository } from '../application/ports/out/product.repository';
import { Price } from '../domain/price';
import { Product } from '../domain/product';
import { Sku } from '../domain/sku';
import { FIXED_NOW, productUuid, skuUuid } from './catalog.fixtures';

function aProduct(suffix: string, skuCount = 2): Product {
  const skus = Array.from({ length: skuCount }, (_, index) =>
    Sku.create({
      id: SkuId.of(skuUuid(`${suffix}${index}`)),
      code: `CODE-${index}`,
      price: Price.of(Money.of(BigInt(1000 + index * 100))),
    }),
  );
  return Product.register({
    id: ProductId.of(productUuid(`${suffix}0`)),
    name: `상품-${suffix}`,
    skus,
    now: FIXED_NOW,
  });
}

/**
 * `ProductRepository`의 계약. in-memory fake와 Prisma 어댑터 양쪽이 통과해야 한다.
 * `createRepo`는 매 테스트마다 **비어 있는** 리포지토리를 돌려줘야 한다.
 */
export function productRepositoryContract(
  name: string,
  createRepo: () => Promise<ProductRepository>,
  runInTransaction?: <T>(work: (tx: TransactionContext) => Promise<T>) => Promise<T>,
): void {
  describe(`ProductRepository 계약 — ${name}`, () => {
    it('저장한 상품을 ID로 찾는다', async () => {
      const repo = await createRepo();
      const product = aProduct('0001');
      await repo.save(product);
      expect((await repo.findById(product.id))?.name).toBe('상품-0001');
    });

    it('없는 ID는 null을 반환한다', async () => {
      const repo = await createRepo();
      expect(await repo.findById(ProductId.of(productUuid('999900')))).toBeNull();
    });

    it('SKU 목록이 애그리거트와 함께 저장되고 복원된다', async () => {
      const repo = await createRepo();
      const product = aProduct('0002');
      await repo.save(product);

      const loaded = await repo.findById(product.id);
      expect(loaded?.skus.map((s) => s.code).sort()).toEqual(['CODE-0', 'CODE-1']);
    });

    it('가격의 금액과 통화가 왕복해도 보존된다', async () => {
      // 금액 버그는 커머스에서 가장 비싼 버그다(스펙 §6.5). bigint가 number를 거쳐
      // 돌아오면 Number.MAX_SAFE_INTEGER를 넘는 값에서 조용히 정밀도를 잃는다.
      const repo = await createRepo();
      const product = Product.register({
        id: ProductId.of(productUuid('000300')),
        name: '고가 상품',
        skus: [
          Sku.create({
            id: SkuId.of(skuUuid('000300')),
            code: 'BIG',
            price: Price.of(Money.of(9007199254740993n)), // Number.MAX_SAFE_INTEGER + 2
          }),
        ],
        now: FIXED_NOW,
      });
      await repo.save(product);

      const loaded = await repo.findById(product.id);
      expect(loaded?.skus[0]?.price.money.amount).toBe(9007199254740993n);
      expect(loaded?.skus[0]?.price.money.currency).toBe('KRW');
    });

    it('생성 시각과 상태가 왕복해도 보존된다', async () => {
      const repo = await createRepo();
      const product = aProduct('0004');
      await repo.save(product);

      const loaded = await repo.findById(product.id);
      expect(loaded?.createdAt).toEqual(FIXED_NOW);
      expect(loaded?.status).toBe('ACTIVE');
    });

    it('가격을 바꿔 다시 저장하면 갱신된다 — 행이 늘지 않는다', async () => {
      const repo = await createRepo();
      const product = aProduct('0005');
      const targetSkuId = product.skus[0]!.id;
      await repo.save(product);

      const loaded = await repo.findById(product.id);
      loaded?.changePrice(targetSkuId, Price.of(Money.of(7777n)));
      if (loaded) await repo.save(loaded);

      const reloaded = await repo.findById(product.id);
      expect(reloaded?.skus).toHaveLength(2);
      expect(reloaded?.findSku(targetSkuId).price.money.amount).toBe(7777n);
    });

    it('애그리거트에서 사라진 SKU는 다시 저장하면 지워진다', async () => {
      // upsert만 하면 지운 SKU가 다음 조회에서 되살아난다. "애그리거트를 저장한다"는
      // 말의 실제 의미가 이것이다.
      const repo = await createRepo();
      const product = aProduct('0011', 3);
      const survivors = [product.skus[0]!, product.skus[1]!];
      const removedId = product.skus[2]!.id;
      await repo.save(product);

      const trimmed = Product.rehydrate({
        id: product.id,
        name: product.name,
        status: product.status,
        skus: [...survivors],
        createdAt: product.createdAt,
      });
      await repo.save(trimmed);

      const reloaded = await repo.findById(product.id);
      expect(reloaded?.skus).toHaveLength(2);
      expect(reloaded?.skus.map((s) => s.id)).not.toContain(removedId);
    });

    it('저장 후 원본을 변경해도 저장본은 바뀌지 않는다', async () => {
      const repo = await createRepo();
      const product = aProduct('0006');
      const targetSkuId = product.skus[0]!.id;
      await repo.save(product);

      product.changePrice(targetSkuId, Price.of(Money.of(1n)));

      const loaded = await repo.findById(product.id);
      expect(loaded?.findSku(targetSkuId).price.money.amount).toBe(1000n);
    });

    it.skipIf(runInTransaction === undefined)(
      '트랜잭션이 롤백되면 저장한 상품이 남지 않는다',
      async () => {
        // in-memory에서는 건너뛴다 — PassthroughTransactionManager는 롤백하지 않으므로
        // 여기서 돌리면 항상 통과하는 무의미한 테스트가 된다. 조용히 빠뜨리지 않고
        // 눈에 보이게 건너뛰는 것이 요점이다.
        const runner = runInTransaction;
        if (!runner) return;
        const repo = await createRepo();
        const product = aProduct('0007');

        await expect(
          runner(async (tx) => {
            await repo.save(product, tx);
            throw new Error('의도적 롤백');
          }),
        ).rejects.toThrow('의도적 롤백');

        expect(await repo.findById(product.id)).toBeNull();
      },
    );
  });
}
