import type { PrismaClient } from '@prisma/client';
import { asPrismaClient } from '../../../../../shared/infrastructure/prisma/prisma-transaction-manager';
import type { SkuId } from '../../../../../shared/kernel/identifiers';
import type { TransactionContext } from '../../../../../shared/kernel/ports/transaction-manager';
import type { StockRepository } from '../../../application/ports/out/stock.repository';
import { StockNotFoundError } from '../../../domain/stock.errors';
import type { StockItem } from '../../../domain/stock-item';
import { type StockRow, toStockDomain } from './stock.mapper';
import { translateStockUniqueViolation } from './stock-unique-violation';

/**
 * 비관적 락 어댑터. **기본 전략이다** (스펙 §6.4).
 *
 * 재고 차감은 짧고 명확한 임계 구역이라, 잠금을 기다리는 편이 재시도를 반복하는
 * 것보다 낫다 — 인기 상품 경합에서 낙관적 락은 재시도가 폭주한다.
 */
export class PessimisticStockRepository implements StockRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * `SELECT ... FOR UPDATE`로 행을 잠그고 `change`를 정확히 한 번 실행한다.
   *
   * 잠금은 **트랜잭션이 끝날 때까지** 유지된다 — 그래서 `tx`가 필수다. 트랜잭션
   * 밖에서 `FOR UPDATE`를 걸면 문장이 끝나는 즉시 잠금이 풀려 아무것도 지키지 못한다.
   *
   * `version` 컬럼을 읽지도 쓰지도 않는다. 스펙 §10.8이 그 컬럼을 낙관적 어댑터
   * 전용으로 못박았고, 두 어댑터를 같은 스키마 위에서 비교하려면 이쪽이 무시해야 한다.
   */
  async mutate<T>(
    skuId: SkuId,
    tx: TransactionContext,
    change: (stock: StockItem) => T,
  ): Promise<T> {
    const client = asPrismaClient(tx) as PrismaClient;

    // Prisma의 쿼리 빌더에는 FOR UPDATE가 없다. 원시 SQL이 유일한 방법이다.
    const rows = await client.$queryRaw<StockRow[]>`
      SELECT sku_id AS "skuId", on_hand AS "onHand", reserved
        FROM stock_items
       WHERE sku_id = ${skuId}::uuid
         FOR UPDATE
    `;
    const row = rows[0];
    if (row === undefined) {
      throw new StockNotFoundError(skuId);
    }

    const stock = toStockDomain(row);
    // change가 던지면 여기서 빠져나가고 UPDATE에 도달하지 않는다 —
    // 재고 부족으로 예약이 거절되는 경로가 그것이다.
    const result = change(stock);

    await client.stockItem.update({
      where: { skuId },
      data: { onHand: stock.onHand.value, reserved: stock.reserved.value },
    });
    return result;
  }

  async findBySkuId(skuId: SkuId, tx?: TransactionContext): Promise<StockItem | null> {
    const row = await this.client(tx).stockItem.findUnique({ where: { skuId } });
    return row === null ? null : toStockDomain(row);
  }

  async create(stock: StockItem, tx?: TransactionContext): Promise<void> {
    // version은 넘기지 않는다 — 스키마 기본값 0에 맡긴다.
    try {
      await this.client(tx).stockItem.create({
        data: { skuId: stock.skuId, onHand: stock.onHand.value, reserved: stock.reserved.value },
      });
    } catch (error) {
      translateStockUniqueViolation(error, stock.skuId);
    }
  }

  private client(tx?: TransactionContext): PrismaClient {
    return tx ? (asPrismaClient(tx) as PrismaClient) : this.prisma;
  }
}
