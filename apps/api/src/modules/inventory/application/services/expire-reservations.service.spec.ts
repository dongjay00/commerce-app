import { describe, expect, it } from 'vitest';
import { Duration } from '../../../../shared/kernel/duration';
import { OrderId, ReservationId, SkuId } from '../../../../shared/kernel/identifiers';
import { Quantity } from '../../../../shared/kernel/quantity';
import { MutableClock } from '../../../../shared/testing/mutable-clock';
import { PassthroughTransactionManager } from '../../../../shared/testing/passthrough-transaction-manager';
import { RecordingEventPublisher } from '../../../../shared/testing/recording-event-publisher';
import { Reservation } from '../../domain/reservation';
import { STOCK_RESERVATION_EXPIRED } from '../../domain/stock.events';
import { StockItem } from '../../domain/stock-item';
import { InMemoryReservationRepository } from '../../testing/in-memory-reservation.repository';
import { InMemoryStockRepository } from '../../testing/in-memory-stock.repository';
import {
  FIXED_NOW,
  orderUuid,
  RESERVATION_TTL,
  reservationUuid,
  skuUuid,
} from '../../testing/inventory.fixtures';
import { ExpireReservationsService } from './expire-reservations.service';

const SKU = SkuId.of(skuUuid('1'));
const q = (n: number) => Quantity.of(n);

function build(batchSize = 100) {
  const stocks = new InMemoryStockRepository();
  const reservations = new InMemoryReservationRepository();
  const events = new RecordingEventPublisher();
  const clock = new MutableClock(FIXED_NOW);
  const service = new ExpireReservationsService(
    stocks,
    reservations,
    events,
    new PassthroughTransactionManager(),
    clock,
    batchSize,
  );
  return { service, stocks, reservations, events, clock };
}

async function seed(
  stocks: InMemoryStockRepository,
  reservations: InMemoryReservationRepository,
  suffix: string,
  quantity: number,
): Promise<Reservation> {
  if ((await stocks.findBySkuId(SKU)) === null) {
    await stocks.create(StockItem.create({ skuId: SKU, onHand: q(100) }));
  }
  await stocks.mutate(SKU, {} as never, (stock) => stock.reserve(q(quantity)));
  const reservation = Reservation.create({
    id: ReservationId.of(reservationUuid(suffix)),
    skuId: SKU,
    orderId: OrderId.of(orderUuid(suffix)),
    quantity: q(quantity),
    now: FIXED_NOW,
    ttl: RESERVATION_TTL,
  });
  reservation.pullEvents();
  await reservations.save(reservation);
  return reservation;
}

describe('ExpireReservationsService', () => {
  it('아직 만료되지 않았으면 아무것도 하지 않는다', async () => {
    const { service, stocks, reservations, clock } = build();
    await seed(stocks, reservations, '1', 3);

    clock.advanceBy(Duration.minutes(14));
    expect(await service.execute()).toBe(0);
    expect((await stocks.findBySkuId(SKU))?.reserved.value).toBe(3);
  });

  it('TTL이 지나면 예약을 만료시키고 재고를 되돌린다', async () => {
    // 스펙 §6.2의 5단계. 보상 트랜잭션이 전부 실패해도 이것이 재고를 회복시킨다.
    const { service, stocks, reservations, clock } = build();
    const reservation = await seed(stocks, reservations, '2', 3);

    clock.advanceBy(Duration.minutes(16));
    expect(await service.execute()).toBe(1);

    const stock = await stocks.findBySkuId(SKU);
    expect(stock?.reserved.value).toBe(0);
    expect(stock?.onHand.value).toBe(100); // 보유량은 안 건드린다
    expect((await reservations.findById(reservation.id))?.status).toBe('EXPIRED');
  });

  it('만료마다 StockReservationExpired를 트랜잭션과 함께 발행한다', async () => {
    // tx가 없으면 재고는 돌아왔는데 Ordering은 주문 실패를 모르고 영원히
    // PENDING_PAYMENT로 남는다(스펙 §6.3).
    const { service, stocks, reservations, events, clock } = build();
    const reservation = await seed(stocks, reservations, '3', 3);

    clock.advanceBy(Duration.minutes(16));
    await service.execute();

    expect(events.published).toHaveLength(1);
    expect(events.published[0]?.eventType).toBe(STOCK_RESERVATION_EXPIRED);
    expect(events.published[0]?.payload).toEqual({
      reservationId: reservation.id,
      skuId: SKU,
      orderId: reservation.orderId,
      quantity: 3,
    });
    expect(events.publishCalls[0]?.tx).toBeDefined();
  });

  it('이미 확정된 예약은 만료시키지 않는다', async () => {
    // 결제가 끝난 예약을 TTL이 뒤늦게 만료시키면 재고가 두 번 돌아가고
    // Ordering은 성공한 주문을 실패로 처리한다.
    const { service, stocks, reservations, clock } = build();
    const reservation = await seed(stocks, reservations, '4', 3);
    reservation.confirm(FIXED_NOW);
    await stocks.mutate(SKU, {} as never, (stock) => stock.confirm(q(3)));
    await reservations.save(reservation);

    clock.advanceBy(Duration.minutes(16));
    expect(await service.execute()).toBe(0);
    expect((await reservations.findById(reservation.id))?.status).toBe('CONFIRMED');
  });

  it('두 번 돌려도 재고가 한 번만 돌아온다', async () => {
    // 스케줄러는 겹쳐 돌 수 있다. 두 번째 실행은 이미 EXPIRED인 예약을 보지 않아야 한다.
    const { service, stocks, reservations, clock } = build();
    await seed(stocks, reservations, '5', 3);

    clock.advanceBy(Duration.minutes(16));
    await service.execute();
    expect(await service.execute()).toBe(0);
    expect((await stocks.findBySkuId(SKU))?.reserved.value).toBe(0);
  });

  it('여러 건을 한 번에 만료시킨다', async () => {
    const { service, stocks, reservations, clock } = build();
    await seed(stocks, reservations, '6', 2);
    await seed(stocks, reservations, '7', 3);

    clock.advanceBy(Duration.minutes(16));
    expect(await service.execute()).toBe(2);
    expect((await stocks.findBySkuId(SKU))?.reserved.value).toBe(0);
  });

  it('batchSize를 넘겨 받지 않는다', async () => {
    // 장애 후 만료가 수만 건 밀려 있을 때 한 번에 다 처리하려 들면
    // 그 실행이 끝나지 않고 다음 주기가 겹쳐 들어온다.
    const { service, stocks, reservations, clock } = build(1);
    await seed(stocks, reservations, '8', 2);
    await seed(stocks, reservations, '9', 3);

    clock.advanceBy(Duration.minutes(16));
    expect(await service.execute()).toBe(1);
    expect(await service.execute()).toBe(1);
  });

  it('한 건이 실패해도 나머지는 처리한다', async () => {
    // 예약 하나당 트랜잭션 하나인 이유다. 한 건의 영구 실패가 뒤의 전부를 막으면
    // 밀린 만료가 영원히 풀리지 않는다.
    const { service, stocks, reservations, clock } = build();
    await seed(stocks, reservations, '10', 2);
    const doomed = await seed(stocks, reservations, '11', 3);
    // 카운터를 어긋나게 만들어 이 건만 StockCounterMismatchError가 나게 한다.
    await stocks.mutate(SKU, {} as never, (stock) => stock.release(q(3)));

    clock.advanceBy(Duration.minutes(16));
    const expiredCount = await service.execute();

    expect(expiredCount).toBe(1);
    expect((await reservations.findById(doomed.id))?.status).toBe('PENDING');
  });
});
