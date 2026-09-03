import type { PrismaClient } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { SystemClock } from '../../../shared/infrastructure/clock/system-clock';
import { UuidV7Generator } from '../../../shared/infrastructure/id/uuid-v7.generator';
import { PrismaTransactionManager } from '../../../shared/infrastructure/prisma/prisma-transaction-manager';
import { Duration } from '../../../shared/kernel/duration';
import { OrderId, SkuId } from '../../../shared/kernel/identifiers';
import { Quantity } from '../../../shared/kernel/quantity';
import { PrismaReservationRepository } from '../adapters/out/persistence/prisma-reservation.repository';
import type { StockRepository } from '../application/ports/out/stock.repository';
import { ReserveStockService } from '../application/services/reserve-stock.service';
import { StockItem } from '../domain/stock-item';

const TTL = Duration.minutes(15);

export interface ConcurrencyOutcome {
  readonly fulfilled: number;
  readonly rejected: number;
  readonly elapsedMs: number;
  readonly available: number;
}

/**
 * 재고 동시성 스위트. **두 Prisma 어댑터에 같은 테스트가 돈다** (스펙 §6.4).
 *
 * 전제: `apps/api/test/setup/database.ts`가 `PrismaPg`에 `max: 20`을 준다.
 * 풀이 작으면 요청이 풀에서 직렬화되어 경합이 아예 발생하지 않고, 락이 없어도
 * 답이 맞아 이 스위트 전체가 거짓 통과한다(스펙 §9.6).
 * `apps/api/test/setup/database.integration.spec.ts`가 그 전제를 지킨다 —
 * 그 테스트가 깨지면 여기 수치를 믿지 말 것.
 *
 * 트랜잭션으로 감싸 롤백하지 않는다. 같은 트랜잭션 안에서는 경합을 재현할 수 없다.
 */
export function stockConcurrencyContract(
  name: string,
  // `testDb()`를 직접 부르지 않는다 — 이 파일은 spec이 아니라 `tsc -p tsconfig.json`의
  // 빌드 대상이고, `test/`는 rootDir 밖이다(계획 2 태스크 1의 TS6059).
  getDb: () => Promise<PrismaClient>,
  makeStockRepo: (prisma: PrismaClient) => StockRepository,
  observeRetries?: (repo: StockRepository) => number,
): void {
  describe(`재고 동시성 — ${name}`, () => {
    async function makeService(
      db: PrismaClient,
      stocks: StockRepository,
      skuId: SkuId,
      onHand: number,
    ): Promise<ReserveStockService> {
      await stocks.create(StockItem.create({ skuId, onHand: Quantity.of(onHand) }));
      return new ReserveStockService(
        stocks,
        new PrismaReservationRepository(db),
        new PrismaTransactionManager(db),
        new SystemClock(),
        new UuidV7Generator(),
        TTL,
      );
    }

    const ids = new UuidV7Generator();

    async function reserveConcurrently(
      skuId: SkuId,
      onHand: number,
      attempts: number,
    ): Promise<{ outcome: ConcurrencyOutcome; retries: number; reasons: string[] }> {
      const db = await getDb();
      const stocks = makeStockRepo(db);
      const service = await makeService(db, stocks, skuId, onHand);

      const startedAt = Date.now();
      const results = await Promise.allSettled(
        Array.from({ length: attempts }, () =>
          service.execute({ skuId, orderId: OrderId.of(ids.nextId()), quantity: 1 }),
        ),
      );
      const elapsedMs = Date.now() - startedAt;

      const remaining = await stocks.findBySkuId(skuId);
      return {
        outcome: {
          fulfilled: results.filter((r) => r.status === 'fulfilled').length,
          rejected: results.filter((r) => r.status === 'rejected').length,
          elapsedMs,
          available: remaining?.available.value ?? -1,
        },
        retries: observeRetries?.(stocks) ?? 0,
        reasons: results
          .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
          .map((r) => (r.reason as Error).constructor.name),
      };
    }

    it('재고 1개에 동시 예약 50건이면 정확히 1건만 성공한다', async () => {
      const { outcome, retries } = await reserveConcurrently(
        SkuId.of('018f2b1c-4a5d-7e6f-8a9b-0c1d5c0c0001'),
        1,
        50,
      );

      // 벤치마크용 수치. 태스크 16이 README 표로 옮긴다.
      console.log(
        `[동시성:${name}] 재고1/시도50 → 성공 ${outcome.fulfilled}, 재시도 ${retries}, ${outcome.elapsedMs}ms`,
      );

      expect(outcome.fulfilled).toBe(1);
      expect(outcome.rejected).toBe(49);
      // 초과 판매가 없다. 이 한 줄이 이 계획 전체의 목표다.
      expect(outcome.available).toBe(0);

      if (observeRetries !== undefined) {
        // 재시도가 한 번도 없었다면 전부 직렬화된 것이고, 그러면 이 테스트는
        // 락이 동작한다는 것을 아무것도 증명하지 않는다. 낙관적 어댑터에서만
        // 확인할 수 있는 신호다 — 비관적 쪽은 Step 4의 뮤테이션이 유일한 증거다.
        expect(retries).toBeGreaterThan(0);
      }
    });

    it('재고 10개에 동시 예약 30건이면 정확히 10건만 성공한다', async () => {
      const { outcome, retries } = await reserveConcurrently(
        SkuId.of('018f2b1c-4a5d-7e6f-8a9b-0c1d5c0c0002'),
        10,
        30,
      );

      console.log(
        `[동시성:${name}] 재고10/시도30 → 성공 ${outcome.fulfilled}, 재시도 ${retries}, ${outcome.elapsedMs}ms`,
      );

      expect(outcome.fulfilled).toBe(10);
      expect(outcome.rejected).toBe(20);
      expect(outcome.available).toBe(0);
    });

    it('실패한 예약은 전부 InsufficientStockError나 StockContentionError다', async () => {
      // 다른 예외가 섞여 있으면 "1건만 성공"이 락 때문이 아니라 버그 때문일 수 있다.
      const { reasons } = await reserveConcurrently(
        SkuId.of('018f2b1c-4a5d-7e6f-8a9b-0c1d5c0c0003'),
        1,
        20,
      );

      const unexpected = reasons.filter(
        (n) => n !== 'InsufficientStockError' && n !== 'StockContentionError',
      );
      expect(unexpected).toEqual([]);
    });

    it('성공한 예약 수만큼 예약 행이 남는다', async () => {
      // 카운터와 예약 행이 어긋나지 않는다는 것 — 편차 4가 감수한 비정규화의
      // 대가가 동시 실행에서도 청구되지 않는지 확인한다.
      const skuId = SkuId.of('018f2b1c-4a5d-7e6f-8a9b-0c1d5c0c0004');
      const db = await getDb();
      const { outcome } = await reserveConcurrently(skuId, 5, 20);

      const rows = await db.$queryRaw<Array<{ count: bigint }>>`
        SELECT count(*)::bigint AS count FROM reservations WHERE sku_id = ${skuId}::uuid
      `;
      expect(Number(rows[0]?.count ?? -1)).toBe(outcome.fulfilled);
      expect(outcome.fulfilled).toBe(5);
    });
  });
}
