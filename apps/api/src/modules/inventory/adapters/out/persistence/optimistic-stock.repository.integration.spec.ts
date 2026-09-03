import type { Prisma, PrismaClient } from '@prisma/client';
import { beforeEach, describe, expect, it } from 'vitest';
import { testDb } from '../../../../../../test/setup/database';
import { PrismaTransactionManager } from '../../../../../shared/infrastructure/prisma/prisma-transaction-manager';
import { SkuId } from '../../../../../shared/kernel/identifiers';
import type { TransactionContext } from '../../../../../shared/kernel/ports/transaction-manager';
import { Quantity } from '../../../../../shared/kernel/quantity';
import { StockContentionError } from '../../../domain/stock.errors';
import { stockRepositoryContract } from '../../../testing/stock-repository.contract';
import { OptimisticStockRepository } from './optimistic-stock.repository';
import { PessimisticStockRepository } from './pessimistic-stock.repository';

stockRepositoryContract(
  'optimistic',
  async () => new OptimisticStockRepository(await testDb()),
  async (work) => new PrismaTransactionManager(await testDb()).run(work),
);

const SKU = '018f2b1c-4a5d-7e6f-8a9b-0c1d5c0f7001';

/**
 * `mutate`의 읽기와 쓰기 사이에 **다른 커넥션이 커밋하도록** 끼워 넣는 트랜잭션 래퍼.
 *
 * 진짜 두 요청을 동시에 띄우면 어느 쪽이 먼저 읽는지가 스케줄러에 달려 테스트가
 * 불안정해진다. 여기서는 첫 읽기 직후에 정확히 한 번 경합을 만들어, 낙관적 락이
 * 반드시 재시도해야 하는 상황을 결정론적으로 재현한다. 경합의 성질(다른 커넥션이
 * 커밋한 새 version)은 진짜 동시 요청과 같다 — 태스크 13이 그 진짜 버전을 돌린다.
 */
function txContendingOnFirstRead(tx: Prisma.TransactionClient, compete: () => Promise<void>) {
  const model = tx.stockItem;
  let fired = false;
  return {
    stockItem: {
      findUnique: async (args: Parameters<typeof model.findUnique>[0]) => {
        const row = await model.findUnique(args);
        if (!fired) {
          fired = true;
          await compete();
        }
        return row;
      },
      updateMany: (args: Parameters<typeof model.updateMany>[0]) => model.updateMany(args),
    },
  } as unknown as TransactionContext;
}

describe('OptimisticStockRepository — 어댑터 전용', () => {
  let db: PrismaClient;

  beforeEach(async () => {
    db = await testDb();
    await db.$executeRawUnsafe(
      `INSERT INTO stock_items (sku_id, on_hand, reserved, version) VALUES ('${SKU}', 10, 0, 0)`,
    );
  });

  const versionOf = async (): Promise<number> => {
    const rows = await db.$queryRawUnsafe<Array<{ version: number }>>(
      `SELECT version FROM stock_items WHERE sku_id = '${SKU}'`,
    );
    return rows[0]?.version ?? -1;
  };

  it('mutate가 성공하면 version이 1 증가한다', async () => {
    const repo = new OptimisticStockRepository(db);

    await new PrismaTransactionManager(db).run((tx) =>
      repo.mutate(SkuId.of(SKU), tx, (stock) => stock.reserve(Quantity.of(3))),
    );

    expect(await versionOf()).toBe(1);
    expect(repo.retries).toBe(0);
  });

  it('같은 연산을 비관적 어댑터로 하면 version은 그대로다', async () => {
    // 스펙 §10.8: version은 낙관적 어댑터 전용 컬럼이다.
    const repo = new PessimisticStockRepository(db);

    await new PrismaTransactionManager(db).run((tx) =>
      repo.mutate(SkuId.of(SKU), tx, (stock) => stock.reserve(Quantity.of(3))),
    );

    expect(await versionOf()).toBe(0);
  });

  it('다른 커넥션이 먼저 쓰면 다시 읽어 성공하고 retries가 1 늘어난다', async () => {
    const repo = new OptimisticStockRepository(db);
    const compete = async (): Promise<void> => {
      // 별도 커넥션에서 즉시 커밋한다. testDb()의 풀이 20이라 가능하다.
      await db.stockItem.update({
        where: { skuId: SKU },
        data: { onHand: 8, version: { increment: 1 } },
      });
    };

    await db.$transaction(async (tx) =>
      repo.mutate(SkuId.of(SKU), txContendingOnFirstRead(tx, compete), (stock) =>
        stock.reserve(Quantity.of(3)),
      ),
    );

    expect(repo.retries).toBe(1);
    // 경쟁자의 on_hand 8이 살아 있다 — 재시도가 다시 읽었다는 증거다.
    // 낡은 값으로 덮어썼다면 10이 되어 갱신이 사라졌을 것이다.
    const rows = await db.$queryRawUnsafe<Array<{ onHand: number; reserved: number }>>(
      `SELECT on_hand AS "onHand", reserved FROM stock_items WHERE sku_id = '${SKU}'`,
    );
    expect(rows[0]).toEqual({ onHand: 8, reserved: 3 });
  });

  it('재시도 한도를 넘으면 StockContentionError다', async () => {
    const repo = new OptimisticStockRepository(db, 1);
    const compete = async (): Promise<void> => {
      await db.stockItem.update({ where: { skuId: SKU }, data: { version: { increment: 1 } } });
    };

    await expect(
      db.$transaction(async (tx) =>
        repo.mutate(SkuId.of(SKU), txContendingOnFirstRead(tx, compete), (stock) =>
          stock.reserve(Quantity.of(3)),
        ),
      ),
    ).rejects.toThrow(StockContentionError);
  });
});
