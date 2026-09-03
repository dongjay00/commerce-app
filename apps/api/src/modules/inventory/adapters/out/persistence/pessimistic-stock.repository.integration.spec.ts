import { describe, expect, it } from 'vitest';
import { testDb } from '../../../../../../test/setup/database';
import { PrismaTransactionManager } from '../../../../../shared/infrastructure/prisma/prisma-transaction-manager';
import { SkuId } from '../../../../../shared/kernel/identifiers';
import { Quantity } from '../../../../../shared/kernel/quantity';
import { CorruptedStockError } from '../../../domain/stock.errors';
import { stockRepositoryContract } from '../../../testing/stock-repository.contract';
import { PessimisticStockRepository } from './pessimistic-stock.repository';

stockRepositoryContract(
  'pessimistic',
  async () => new PessimisticStockRepository(await testDb()),
  async (work) => new PrismaTransactionManager(await testDb()).run(work),
);

describe('PessimisticStockRepository — 어댑터 전용', () => {
  it('reserved > on_hand인 저장 행을 읽으면 CorruptedStockError다', async () => {
    // 계약 스위트는 정상 데이터만 다룬다. 손상된 행은 원시 SQL로만 만들 수 있다.
    const db = await testDb();
    await db.$executeRawUnsafe(`
      INSERT INTO stock_items (sku_id, on_hand, reserved, version)
      VALUES ('018f2b1c-4a5d-7e6f-8a9b-0c1d5cbad001', 3, 5, 0)
    `);
    const repo = new PessimisticStockRepository(db);

    await expect(
      repo.findBySkuId(SkuId.of('018f2b1c-4a5d-7e6f-8a9b-0c1d5cbad001')),
    ).rejects.toThrow(CorruptedStockError);
  });

  it('version 컬럼을 건드리지 않는다', async () => {
    // 스펙 §10.8: version은 낙관적 어댑터 전용이다. 비관적 어댑터가 이 컬럼을
    // 건드리면 두 어댑터를 같은 스키마로 비교한다는 전제가 깨진다.
    const db = await testDb();
    const skuId = SkuId.of('018f2b1c-4a5d-7e6f-8a9b-0c1d5cfed001');
    const repo = new PessimisticStockRepository(db);
    await db.$executeRawUnsafe(
      `INSERT INTO stock_items (sku_id, on_hand, reserved, version) VALUES ('${skuId}', 10, 0, 7)`,
    );

    await new PrismaTransactionManager(db).run((tx) =>
      repo.mutate(skuId, tx, (stock) => stock.reserve(Quantity.of(4))),
    );

    const rows = await db.$queryRawUnsafe<Array<{ version: number; reserved: number }>>(
      `SELECT version, reserved FROM stock_items WHERE sku_id = '${skuId}'`,
    );
    // 예약은 반영되었는데 version은 넣은 값 그대로다.
    expect(rows[0]?.reserved).toBe(4);
    expect(rows[0]?.version).toBe(7);
  });
});
