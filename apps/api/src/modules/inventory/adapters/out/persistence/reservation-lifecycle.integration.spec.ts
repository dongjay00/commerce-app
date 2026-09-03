import type { PrismaClient } from '@prisma/client';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { testDb } from '../../../../../../test/setup/database';
import { UuidV7Generator } from '../../../../../shared/infrastructure/id/uuid-v7.generator';
import { PrismaTransactionManager } from '../../../../../shared/infrastructure/prisma/prisma-transaction-manager';
import { Duration } from '../../../../../shared/kernel/duration';
import { OrderId, SkuId } from '../../../../../shared/kernel/identifiers';
import { Quantity } from '../../../../../shared/kernel/quantity';
import { MutableClock } from '../../../../../shared/testing/mutable-clock';
import { ConfirmReservationService } from '../../../application/services/confirm-reservation.service';
import { RegisterStockService } from '../../../application/services/register-stock.service';
import { ReleaseReservationService } from '../../../application/services/release-reservation.service';
import { ReserveStockService } from '../../../application/services/reserve-stock.service';
import { PessimisticStockRepository } from './pessimistic-stock.repository';
import { PrismaReservationRepository } from './prisma-reservation.repository';

/**
 * 예약 수명주기가 **진짜 Postgres 위에서** 도는지 확인한다.
 *
 * 확정과 해제의 단위 테스트는 in-memory 리포지토리로 돈다. 그것으로 도메인 규칙은
 * 검증되지만, 카운터 갱신과 예약 행 갱신이 **한 트랜잭션 안에서** 함께 커밋되는지는
 * 진짜 DB에서만 보인다 — 편차 4가 감수한 비정규화의 대가가 청구되는 자리다.
 */
let db: PrismaClient;

const NOW = new Date('2026-02-01T00:00:00.000Z');
const TTL = Duration.minutes(15);

beforeAll(async () => {
  db = await testDb();
});

beforeEach(async () => {
  await db.$executeRawUnsafe('TRUNCATE reservations, stock_items, outbox CASCADE');
});

async function setup(skuSuffix: string) {
  const skuId = SkuId.of(`018f2b1c-4a5d-7e6f-8a9b-0c1d5cbc${skuSuffix.padStart(4, '0')}`);
  const stocks = new PessimisticStockRepository(db);
  const reservations = new PrismaReservationRepository(db);
  const transactions = new PrismaTransactionManager(db);
  const clock = new MutableClock(NOW);
  const ids = new UuidV7Generator();

  await new RegisterStockService(stocks, transactions).execute({ skuId, onHand: 10 });
  const { reservationId } = await new ReserveStockService(
    stocks,
    reservations,
    transactions,
    clock,
    ids,
    TTL,
  ).execute({ skuId, orderId: OrderId.of(ids.nextId()), quantity: Quantity.of(3).value });

  return {
    skuId,
    reservationId,
    stocks,
    confirm: new ConfirmReservationService(stocks, reservations, transactions, clock),
    release: new ReleaseReservationService(stocks, reservations, transactions, clock),
  };
}

const statusOf = async (id: string): Promise<string | undefined> =>
  (await db.reservation.findUnique({ where: { id } }))?.status;

describe('예약 수명주기 — 실제 Postgres', () => {
  it('등록 → 예약하면 보유량은 그대로이고 예약량이 잡힌다', async () => {
    const { skuId, stocks } = await setup('1');

    const stock = await stocks.findBySkuId(skuId);
    expect(stock?.onHand.value).toBe(10);
    expect(stock?.reserved.value).toBe(3);
    expect(stock?.available.value).toBe(7);
  });

  it('확정하면 보유량이 줄고 예약이 풀리며 행이 CONFIRMED가 된다', async () => {
    const { skuId, reservationId, stocks, confirm } = await setup('2');

    await confirm.execute({ reservationId });

    const stock = await stocks.findBySkuId(skuId);
    // 카운터와 예약 행이 어긋나지 않는다 — 둘이 같은 트랜잭션에서 커밋됐다는 뜻이다.
    expect(stock?.onHand.value).toBe(7);
    expect(stock?.reserved.value).toBe(0);
    expect(await statusOf(reservationId)).toBe('CONFIRMED');
  });

  it('해제하면 보유량이 그대로 돌아오고 행이 RELEASED가 된다', async () => {
    const { skuId, reservationId, stocks, release } = await setup('3');

    await release.execute({ reservationId });

    const stock = await stocks.findBySkuId(skuId);
    expect(stock?.onHand.value).toBe(10);
    expect(stock?.reserved.value).toBe(0);
    expect(await statusOf(reservationId)).toBe('RELEASED');
  });

  it('확정을 두 번 해도 재고가 두 번 줄지 않는다 — at-least-once 멱등성', async () => {
    // Outbox 릴레이는 at-least-once다. 같은 이벤트가 두 번 도착해도 재고가
    // 두 번 차감되면 안 된다 — Reservation의 전이 메서드가 boolean을 돌려주는
    // 설계가 그 요구를 갚는 자리다.
    const { skuId, reservationId, stocks, confirm } = await setup('4');

    await confirm.execute({ reservationId });
    await confirm.execute({ reservationId });

    expect((await stocks.findBySkuId(skuId))?.onHand.value).toBe(7);
  });
});
