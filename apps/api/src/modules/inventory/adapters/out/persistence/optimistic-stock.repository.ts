import type { PrismaClient } from '@prisma/client';
import { asPrismaClient } from '../../../../../shared/infrastructure/prisma/prisma-transaction-manager';
import type { SkuId } from '../../../../../shared/kernel/identifiers';
import type { TransactionContext } from '../../../../../shared/kernel/ports/transaction-manager';
import type { StockRepository } from '../../../application/ports/out/stock.repository';
import { StockContentionError, StockNotFoundError } from '../../../domain/stock.errors';
import type { StockItem } from '../../../domain/stock-item';
import { toStockDomain } from './stock.mapper';

const DEFAULT_MAX_ATTEMPTS = 20;

/**
 * 낙관적 락 어댑터. **비교군이다** (스펙 §6.4) — 기본 전략은 비관적 쪽이다.
 *
 * 같은 도메인 코드와 같은 계약·동시성 스위트를 두 어댑터에 돌려 비교하는 것이
 * 이 어댑터의 존재 이유다.
 */
export class OptimisticStockRepository implements StockRepository {
  /**
   * 재시도 횟수. 스펙 §6.4가 README 벤치마크에 실기로 한 세 지표 중 하나다
   * (초과 판매 여부, 처리량, 재시도 횟수). 비관적 어댑터에는 이 필드가 없다 —
   * 재시도를 하지 않기 때문이고, 두 표면이 다른 것이 그 차이를 드러낸다.
   */
  retries = 0;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly maxAttempts: number = DEFAULT_MAX_ATTEMPTS,
  ) {}

  /**
   * 읽고 → `change`를 적용하고 → `WHERE version = <읽은 값>`으로 UPDATE한다.
   * 0행이 갱신되면 다른 트랜잭션이 먼저 쓴 것이므로 **처음부터 다시** 한다.
   *
   * 다시 읽는 것이 핵심이다. `UPDATE`만 재시도하면 낡은 데이터로 내린 도메인 판단을
   * 그대로 다시 쓰게 된다 — 재고가 1개 남았을 때 두 요청이 모두 "가능하다"고 판단한
   * 뒤 순서대로 쓰면 초과 판매가 된다.
   *
   * Postgres의 기본 격리 수준은 READ COMMITTED라, 같은 트랜잭션 안에서 다시 읽어도
   * 그사이 커밋된 다른 트랜잭션의 값이 보인다. 그래서 이 재시도가 성립한다.
   *
   * `change`는 재시도마다 다시 실행된다. 부수 효과가 있는 `change`(예약 객체 생성 등)는
   * 매번 새 객체를 만들고 버려진 것들은 저장되지 않는다 — 반환된 마지막 것만 쓰인다.
   */
  async mutate<T>(
    skuId: SkuId,
    tx: TransactionContext,
    change: (stock: StockItem) => T,
  ): Promise<T> {
    const client = asPrismaClient(tx);

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      const row = await client.stockItem.findUnique({ where: { skuId } });
      if (row === null) {
        throw new StockNotFoundError(skuId);
      }

      const stock = toStockDomain(row);
      // change가 던지면 그대로 전파된다 — 재고 부족은 재시도 대상이 아니다.
      // 다시 읽어봐야 재고가 늘어날 리 없고, 재시도하면 그만큼 응답이 늦어질 뿐이다.
      const result = change(stock);

      const updated = await client.stockItem.updateMany({
        where: { skuId, version: row.version },
        data: {
          onHand: stock.onHand.value,
          reserved: stock.reserved.value,
          version: row.version + 1,
        },
      });

      if (updated.count === 1) {
        return result;
      }
      this.retries += 1;
    }

    throw new StockContentionError(skuId, this.maxAttempts);
  }

  async findBySkuId(skuId: SkuId, tx?: TransactionContext): Promise<StockItem | null> {
    const row = await this.client(tx).stockItem.findUnique({ where: { skuId } });
    return row === null ? null : toStockDomain(row);
  }

  async create(stock: StockItem, tx?: TransactionContext): Promise<void> {
    // version은 넘기지 않는다 — 스키마 기본값 0에 맡긴다.
    await this.client(tx).stockItem.create({
      data: { skuId: stock.skuId, onHand: stock.onHand.value, reserved: stock.reserved.value },
    });
  }

  private client(tx?: TransactionContext): PrismaClient {
    return tx ? (asPrismaClient(tx) as PrismaClient) : this.prisma;
  }
}
