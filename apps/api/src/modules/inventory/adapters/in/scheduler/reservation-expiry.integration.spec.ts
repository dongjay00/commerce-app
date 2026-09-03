import type { PrismaClient } from '@prisma/client';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { testDb } from '../../../../../../test/setup/database';
import { UuidV7Generator } from '../../../../../shared/infrastructure/id/uuid-v7.generator';
import { OutboxEventPublisher } from '../../../../../shared/infrastructure/outbox/outbox-event.publisher';
import { OutboxRelay } from '../../../../../shared/infrastructure/outbox/outbox-relay';
import { PrismaTransactionManager } from '../../../../../shared/infrastructure/prisma/prisma-transaction-manager';
import { Duration } from '../../../../../shared/kernel/duration';
import { OrderId, ReservationId, SkuId } from '../../../../../shared/kernel/identifiers';
import { Quantity } from '../../../../../shared/kernel/quantity';
import { MutableClock } from '../../../../../shared/testing/mutable-clock';
import { RecordingEventTransport } from '../../../../../shared/testing/recording-event-transport';
import { ExpireReservationsService } from '../../../application/services/expire-reservations.service';
import { Reservation } from '../../../domain/reservation';
import { STOCK_RESERVATION_EXPIRED } from '../../../domain/stock.events';
import { StockItem } from '../../../domain/stock-item';
import { PessimisticStockRepository } from '../../out/persistence/pessimistic-stock.repository';
import { PrismaReservationRepository } from '../../out/persistence/prisma-reservation.repository';

let db: PrismaClient;

const NOW = new Date('2026-02-01T00:00:00.000Z');
const TTL = Duration.minutes(15);
const SKU = SkuId.of('018f2b1c-4a5d-7e6f-8a9b-0c1d5cfa1001');

beforeAll(async () => {
  db = await testDb();
});

beforeEach(async () => {
  await db.$executeRawUnsafe('TRUNCATE reservations, stock_items, outbox CASCADE');
});

/**
 * **outbox 전체 경로를 처음으로 끝까지 통과시키는 테스트다.**
 *
 * 계획 1이 `OutboxRelay`를 만든 뒤 프로덕션 호출자가 한 번도 없었다 — 이벤트를
 * outbox에 넣는 코드는 있었지만 그것이 어디에도 도착하지 않았다. 태스크 15가
 * 릴레이 스케줄러를 배선했고, 여기서 그 경로가 실제로 이어지는지 확인한다.
 *
 * 스케줄러 자체가 아니라 **경로**를 본다. 타이머 동작은
 * `interval-scheduler.spec.ts`가 가짜 타이머로 따로 검사한다.
 */
describe('만료 → outbox → 릴레이', () => {
  it('만료된 예약이 outbox에 이벤트를 남기고 릴레이가 그것을 발행한다', async () => {
    const clock = new MutableClock(NOW);
    const stocks = new PessimisticStockRepository(db);
    const reservations = new PrismaReservationRepository(db);
    const transactions = new PrismaTransactionManager(db);
    const ids = new UuidV7Generator();

    // 1) 재고와 예약을 만든다
    const stock = StockItem.create({ skuId: SKU, onHand: Quantity.of(10) });
    stock.reserve(Quantity.of(3));
    await stocks.create(stock);
    const reservation = Reservation.create({
      id: ReservationId.of(ids.nextId()),
      skuId: SKU,
      orderId: OrderId.of(ids.nextId()),
      quantity: Quantity.of(3),
      now: NOW,
      ttl: TTL,
    });
    await transactions.run((tx) => reservations.save(reservation, tx));

    // 2) TTL을 넘기고 만료 유스케이스를 직접 부른다(스케줄러 없이)
    clock.setTo(new Date(NOW.getTime() + TTL.millis + 1_000));
    const expired = await new ExpireReservationsService(
      stocks,
      reservations,
      new OutboxEventPublisher(db, ids),
      transactions,
      clock,
    ).execute();
    expect(expired).toBe(1);

    // 3) outbox에 미발행 행이 있다
    const pending = await db.outbox.findMany({ where: { publishedAt: null } });
    expect(pending).toHaveLength(1);
    expect(pending[0]?.eventType).toBe(STOCK_RESERVATION_EXPIRED);

    // 4) 릴레이를 직접 부른다
    const transport = new RecordingEventTransport();
    const sent = await new OutboxRelay(db, transport, clock).relayOnce();
    expect(sent).toBe(1);

    // 5) published_at이 채워졌고 전송에 도착했다
    const after = await db.outbox.findMany();
    expect(after[0]?.publishedAt).not.toBeNull();
    expect(transport.sent.map((e) => e.eventType)).toEqual([STOCK_RESERVATION_EXPIRED]);
    expect(transport.sent[0]?.payload).toMatchObject({ skuId: SKU, quantity: 3 });

    // 그리고 재고가 실제로 돌아왔다 — 자가치유의 요점이다.
    expect((await stocks.findBySkuId(SKU))?.reserved.value).toBe(0);
  });
});
