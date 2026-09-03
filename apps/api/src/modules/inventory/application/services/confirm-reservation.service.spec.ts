import { describe, expect, it } from 'vitest';
import { OrderId, ReservationId, SkuId } from '../../../../shared/kernel/identifiers';
import { Quantity } from '../../../../shared/kernel/quantity';
import { MutableClock } from '../../../../shared/testing/mutable-clock';
import { PassthroughTransactionManager } from '../../../../shared/testing/passthrough-transaction-manager';
import { Reservation } from '../../domain/reservation';
import { ReservationConflictError, ReservationNotFoundError } from '../../domain/stock.errors';
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
import { ConfirmReservationService } from './confirm-reservation.service';
import { ReleaseReservationService } from './release-reservation.service';

const SKU = SkuId.of(skuUuid('1'));
const RESERVATION = ReservationId.of(reservationUuid('1'));

async function build() {
  const stocks = new InMemoryStockRepository();
  const reservations = new InMemoryReservationRepository();
  const tx = new PassthroughTransactionManager();
  const clock = new MutableClock(FIXED_NOW);
  await stocks.create(StockItem.create({ skuId: SKU, onHand: Quantity.of(10) }));
  await stocks.mutate(SKU, {} as never, (stock) => stock.reserve(Quantity.of(3)));
  const reservation = Reservation.create({
    id: RESERVATION,
    skuId: SKU,
    orderId: OrderId.of(orderUuid('1')),
    quantity: Quantity.of(3),
    now: FIXED_NOW,
    ttl: RESERVATION_TTL,
  });
  reservation.pullEvents();
  await reservations.save(reservation);
  return {
    confirm: new ConfirmReservationService(stocks, reservations, tx, clock),
    release: new ReleaseReservationService(stocks, reservations, tx, clock),
    stocks,
    reservations,
  };
}

describe('ConfirmReservationService', () => {
  it('확정하면 상태가 CONFIRMED가 되고 보유량·예약량이 함께 준다', async () => {
    const { confirm, stocks, reservations } = await build();
    await confirm.execute({ reservationId: RESERVATION });

    const stock = await stocks.findBySkuId(SKU);
    expect(stock?.onHand.value).toBe(7);
    expect(stock?.reserved.value).toBe(0);
    expect((await reservations.findById(RESERVATION))?.status).toBe('CONFIRMED');
  });

  it('두 번 확정해도 재고가 한 번만 줄어든다', async () => {
    // Outbox는 at-least-once라 OrderPaid가 두 번 배달되는 것이 정상이다(스펙 §6.3).
    // 여기서 카운터를 두 번 줄이면 재고가 조용히 사라진다.
    const { confirm, stocks } = await build();
    await confirm.execute({ reservationId: RESERVATION });
    await confirm.execute({ reservationId: RESERVATION });

    const stock = await stocks.findBySkuId(SKU);
    expect(stock?.onHand.value).toBe(7);
    expect(stock?.reserved.value).toBe(0);
  });

  it('없는 예약이면 ReservationNotFoundError다', async () => {
    const { confirm } = await build();
    await expect(confirm.execute({ reservationId: reservationUuid('9999') })).rejects.toThrow(
      ReservationNotFoundError,
    );
  });

  it('이미 해제된 예약을 확정하면 ReservationConflictError이고 재고는 그대로다', async () => {
    const { confirm, release, stocks } = await build();
    await release.execute({ reservationId: RESERVATION });

    await expect(confirm.execute({ reservationId: RESERVATION })).rejects.toThrow(
      ReservationConflictError,
    );
    const stock = await stocks.findBySkuId(SKU);
    expect(stock?.onHand.value).toBe(10);
    expect(stock?.reserved.value).toBe(0);
  });
});

describe('ReleaseReservationService', () => {
  it('해제하면 상태가 RELEASED가 되고 예약량만 준다', async () => {
    const { release, stocks, reservations } = await build();
    await release.execute({ reservationId: RESERVATION });

    const stock = await stocks.findBySkuId(SKU);
    expect(stock?.onHand.value).toBe(10); // 보유량은 그대로
    expect(stock?.reserved.value).toBe(0);
    expect((await reservations.findById(RESERVATION))?.status).toBe('RELEASED');
  });

  it('두 번 해제해도 재고가 한 번만 돌아온다', async () => {
    const { release, stocks } = await build();
    await release.execute({ reservationId: RESERVATION });
    await release.execute({ reservationId: RESERVATION });

    expect((await stocks.findBySkuId(SKU))?.reserved.value).toBe(0);
  });

  it('이미 확정된 예약을 해제하면 ReservationConflictError이고 재고는 그대로다', async () => {
    const { confirm, release, stocks } = await build();
    await confirm.execute({ reservationId: RESERVATION });

    await expect(release.execute({ reservationId: RESERVATION })).rejects.toThrow(
      ReservationConflictError,
    );
    const stock = await stocks.findBySkuId(SKU);
    expect(stock?.onHand.value).toBe(7);
  });
});
