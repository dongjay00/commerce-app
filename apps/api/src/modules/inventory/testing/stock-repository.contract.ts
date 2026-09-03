import { describe, expect, it } from 'vitest';
import { SkuId } from '../../../shared/kernel/identifiers';
import type { TransactionContext } from '../../../shared/kernel/ports/transaction-manager';
import { Quantity } from '../../../shared/kernel/quantity';
import type { StockRepository } from '../application/ports/out/stock.repository';
import {
  InsufficientStockError,
  StockAlreadyExistsError,
  StockNotFoundError,
} from '../domain/stock.errors';
import { StockItem } from '../domain/stock-item';
import { skuUuid } from './inventory.fixtures';

const q = (n: number) => Quantity.of(n);
const sku = (suffix: string) => SkuId.of(skuUuid(suffix));

/**
 * `StockRepository`의 계약. **세 구현이 통과해야 한다** — in-memory fake, 비관적
 * Prisma 어댑터, 낙관적 Prisma 어댑터. 락 전략이 다르다는 것이 관측 가능한 동작의
 * 차이로 새어 나오면 안 된다는 것이 이 스위트의 주장이다.
 */
export function stockRepositoryContract(
  name: string,
  createRepo: () => Promise<StockRepository>,
  runInTransaction?: <T>(work: (tx: TransactionContext) => Promise<T>) => Promise<T>,
): void {
  // in-memory는 tx를 무시하고, Prisma 어댑터는 진짜 트랜잭션을 연다.
  const run = <T>(work: (tx: TransactionContext) => Promise<T>): Promise<T> =>
    runInTransaction ? runInTransaction(work) : work({} as TransactionContext);

  describe(`StockRepository 계약 — ${name}`, () => {
    it('생성한 재고를 SKU ID로 찾는다', async () => {
      const repo = await createRepo();
      await repo.create(StockItem.create({ skuId: sku('1'), onHand: q(10) }));

      const found = await repo.findBySkuId(sku('1'));
      expect(found?.onHand.value).toBe(10);
      expect(found?.reserved.value).toBe(0);
    });

    it('없는 SKU는 null을 반환한다', async () => {
      const repo = await createRepo();
      expect(await repo.findBySkuId(sku('9999'))).toBeNull();
    });

    it('보유량과 예약량이 왕복해도 보존된다', async () => {
      const repo = await createRepo();
      await repo.create(StockItem.create({ skuId: sku('2'), onHand: q(10) }));
      await run((tx) => repo.mutate(sku('2'), tx, (stock) => stock.reserve(q(4))));

      const found = await repo.findBySkuId(sku('2'));
      expect(found?.onHand.value).toBe(10);
      expect(found?.reserved.value).toBe(4);
      expect(found?.available.value).toBe(6);
    });

    it('mutate가 change의 반환값을 그대로 돌려준다', async () => {
      // 예약 유스케이스가 mutate 안에서 Reservation을 만들어 돌려받는다.
      const repo = await createRepo();
      await repo.create(StockItem.create({ skuId: sku('3'), onHand: q(10) }));

      const result = await run((tx) =>
        repo.mutate(sku('3'), tx, (stock) => {
          stock.reserve(q(2));
          return `예약됨:${stock.reserved.value}`;
        }),
      );
      expect(result).toBe('예약됨:2');
    });

    it('없는 SKU를 mutate하면 StockNotFoundError다', async () => {
      const repo = await createRepo();
      await expect(
        run((tx) => repo.mutate(sku('9998'), tx, (stock) => stock.reserve(q(1)))),
      ).rejects.toThrow(StockNotFoundError);
    });

    it('change가 던지면 아무것도 저장되지 않는다', async () => {
      // 재고 부족으로 예약이 거절되는 경로다. 여기서 부분 저장이 일어나면
      // 실패한 예약이 재고를 갉아먹는다.
      const repo = await createRepo();
      await repo.create(StockItem.create({ skuId: sku('4'), onHand: q(3) }));

      await expect(
        run((tx) => repo.mutate(sku('4'), tx, (stock) => stock.reserve(q(5)))),
      ).rejects.toThrow(InsufficientStockError);

      const found = await repo.findBySkuId(sku('4'));
      expect(found?.reserved.value).toBe(0);
      expect(found?.onHand.value).toBe(3);
    });

    it('change가 재고를 바꾼 뒤에 던져도 아무것도 저장되지 않는다', async () => {
      // 위 케이스는 리포지토리가 아니라 도메인의 성질을 재확인한다 —
      // `StockItem.reserve`가 갱신 전에 검사하므로 예외가 나도 부분 변경이 없다.
      // 이 케이스는 change가 **성공적으로 바꾼 뒤** 던지게 만들어, 저장하지 않는
      // 책임이 리포지토리에 있다는 것을 분리해서 고정한다.
      const repo = await createRepo();
      await repo.create(StockItem.create({ skuId: sku('41'), onHand: q(10) }));

      await expect(
        run((tx) =>
          repo.mutate(sku('41'), tx, (stock) => {
            stock.reserve(q(4));
            throw new Error('변경 후 실패');
          }),
        ),
      ).rejects.toThrow('변경 후 실패');

      expect((await repo.findBySkuId(sku('41')))?.reserved.value).toBe(0);
    });

    it('연속된 mutate가 누적된다', async () => {
      const repo = await createRepo();
      await repo.create(StockItem.create({ skuId: sku('5'), onHand: q(10) }));

      await run((tx) => repo.mutate(sku('5'), tx, (stock) => stock.reserve(q(2))));
      await run((tx) => repo.mutate(sku('5'), tx, (stock) => stock.reserve(q(3))));

      expect((await repo.findBySkuId(sku('5')))?.reserved.value).toBe(5);
    });

    it('확정은 보유량과 예약량을 함께 줄인다', async () => {
      const repo = await createRepo();
      await repo.create(StockItem.create({ skuId: sku('6'), onHand: q(10) }));
      await run((tx) => repo.mutate(sku('6'), tx, (stock) => stock.reserve(q(4))));
      await run((tx) => repo.mutate(sku('6'), tx, (stock) => stock.confirm(q(4))));

      const found = await repo.findBySkuId(sku('6'));
      expect(found?.onHand.value).toBe(6);
      expect(found?.reserved.value).toBe(0);
    });

    it('해제는 예약량만 줄인다', async () => {
      const repo = await createRepo();
      await repo.create(StockItem.create({ skuId: sku('7'), onHand: q(10) }));
      await run((tx) => repo.mutate(sku('7'), tx, (stock) => stock.reserve(q(4))));
      await run((tx) => repo.mutate(sku('7'), tx, (stock) => stock.release(q(4))));

      const found = await repo.findBySkuId(sku('7'));
      expect(found?.onHand.value).toBe(10);
      expect(found?.reserved.value).toBe(0);
    });

    it('같은 SKU를 두 번 create하면 던진다', async () => {
      // 재고 행이 조용히 덮어써지면 관리자가 입고를 두 번 눌렀을 때 보유량이 사라진다.
      const repo = await createRepo();
      await repo.create(StockItem.create({ skuId: sku('8'), onHand: q(10) }));
      await expect(
        repo.create(StockItem.create({ skuId: sku('8'), onHand: q(99) })),
      ).rejects.toThrow(StockAlreadyExistsError);
    });

    it('mutate가 돌려준 StockItem을 나중에 바꿔도 저장본은 안 바뀐다', async () => {
      const repo = await createRepo();
      await repo.create(StockItem.create({ skuId: sku('9'), onHand: q(10) }));

      const escaped = await run((tx) =>
        repo.mutate(sku('9'), tx, (stock) => {
          stock.reserve(q(1));
          return stock; // 애그리거트를 밖으로 내보낸다 — 하면 안 되지만 막을 수는 없다
        }),
      );
      escaped.reserve(q(5));

      expect((await repo.findBySkuId(sku('9')))?.reserved.value).toBe(1);
    });

    it.skipIf(runInTransaction === undefined)(
      '트랜잭션이 롤백되면 재고 변경이 남지 않는다',
      async () => {
        const runner = runInTransaction;
        if (!runner) return;
        const repo = await createRepo();
        await repo.create(StockItem.create({ skuId: sku('10'), onHand: q(10) }));

        await expect(
          runner(async (tx) => {
            await repo.mutate(sku('10'), tx, (stock) => stock.reserve(q(3)));
            throw new Error('의도적 롤백');
          }),
        ).rejects.toThrow('의도적 롤백');

        expect((await repo.findBySkuId(sku('10')))?.reserved.value).toBe(0);
      },
    );
  });
}
