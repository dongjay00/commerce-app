import { describe, expect, it } from 'vitest';
import { OrderId, ReservationId, SkuId } from '../../../../shared/kernel/identifiers';
import { Quantity } from '../../../../shared/kernel/quantity';
import { MutableClock } from '../../../../shared/testing/mutable-clock';
import { PassthroughTransactionManager } from '../../../../shared/testing/passthrough-transaction-manager';
import { Reservation } from '../../domain/reservation';
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
import { ReservationsForOrderService } from './reservations-for-order.service';

const ORDER = orderUuid('1');

/** SKU 두 개에 걸친 주문. 각각 재고 10, 예약 3. */
async function build(options: { confirm?: boolean; skuBOnHand?: number } = {}) {
  const stocks = new InMemoryStockRepository();
  const reservations = new InMemoryReservationRepository();

  for (const [suffix, onHand] of [
    ['1', 10],
    ['2', options.skuBOnHand ?? 10],
  ] as const) {
    const stock = StockItem.create({
      skuId: SkuId.of(skuUuid(suffix)),
      onHand: Quantity.of(onHand),
    });
    stock.reserve(Quantity.of(3));
    await stocks.create(stock);

    const reservation = Reservation.create({
      id: ReservationId.of(reservationUuid(suffix)),
      skuId: SkuId.of(skuUuid(suffix)),
      orderId: OrderId.of(ORDER),
      quantity: Quantity.of(3),
      now: FIXED_NOW,
      ttl: RESERVATION_TTL,
    });
    reservation.pullEvents();
    if (options.confirm === true) {
      reservation.confirm(FIXED_NOW);
      await stocks.mutate(SkuId.of(skuUuid(suffix)), {} as never, (s) => {
        s.confirm(Quantity.of(3));
      });
    }
    await reservations.save(reservation);
  }

  const service = new ReservationsForOrderService(
    stocks,
    reservations,
    new PassthroughTransactionManager(),
    new MutableClock(FIXED_NOW),
  );
  return { service, stocks, reservations };
}

const stockOf = async (
  stocks: InMemoryStockRepository,
  suffix: string,
): Promise<{ onHand: number; reserved: number }> => {
  const stock = await stocks.findBySkuId(SkuId.of(skuUuid(suffix)));
  return { onHand: stock?.onHand.value ?? -1, reserved: stock?.reserved.value ?? -1 };
};

describe('ReservationsForOrderService.confirm', () => {
  it('주문의 예약 2건을 확정하면 2를 돌려주고 두 SKU가 차감된다', async () => {
    const { service, stocks } = await build();

    expect(await service.confirm({ orderId: ORDER })).toBe(2);

    expect(await stockOf(stocks, '1')).toEqual({ onHand: 7, reserved: 0 });
    expect(await stockOf(stocks, '2')).toEqual({ onHand: 7, reserved: 0 });
  });

  it('이미 확정된 예약에 다시 부르면 0이고 재고가 다시 줄지 않는다', async () => {
    // at-least-once 배달. 막지 못하면 재고가 두 번 차감된다.
    const { service, stocks } = await build();
    await service.confirm({ orderId: ORDER });

    expect(await service.confirm({ orderId: ORDER })).toBe(0);
    expect(await stockOf(stocks, '1')).toEqual({ onHand: 7, reserved: 0 });
  });

  it('없는 주문이면 0이다', async () => {
    const { service } = await build();
    expect(await service.confirm({ orderId: orderUuid('9') })).toBe(0);
  });
});

describe('ReservationsForOrderService.release', () => {
  it('해제하면 reserved가 줄고 onHand는 그대로다', async () => {
    const { service, stocks } = await build();

    expect(await service.release({ orderId: ORDER })).toBe(2);

    expect(await stockOf(stocks, '1')).toEqual({ onHand: 10, reserved: 0 });
  });

  it('두 번 해제하면 두 번째는 0이다', async () => {
    const { service } = await build();
    await service.release({ orderId: ORDER });
    expect(await service.release({ orderId: ORDER })).toBe(0);
  });
});

describe('ReservationsForOrderService.restore', () => {
  it('복원하면 onHand가 늘고 reserved는 그대로다', async () => {
    const { service, stocks } = await build({ confirm: true });
    expect(await stockOf(stocks, '1')).toEqual({ onHand: 7, reserved: 0 });

    expect(await service.restore({ orderId: ORDER })).toBe(2);

    expect(await stockOf(stocks, '1')).toEqual({ onHand: 10, reserved: 0 });
  });

  it('두 번 복원하면 재고가 두 번 늘지 않는다', async () => {
    // 이 회귀는 팔 수 있는 수량을 실제보다 많게 만들어 초과 판매로 이어진다.
    const { service, stocks } = await build({ confirm: true });
    await service.restore({ orderId: ORDER });

    expect(await service.restore({ orderId: ORDER })).toBe(0);
    expect(await stockOf(stocks, '1')).toEqual({ onHand: 10, reserved: 0 });
  });

  it('확정되지 않은 예약은 건너뛰고 0을 돌려준다', async () => {
    // PENDING 예약을 복원하려는 것은 사가가 순서를 잃었다는 뜻이다. 예외는
    // 로그로 남고 나머지 처리를 막지 않는다.
    const { service, stocks } = await build();

    expect(await service.restore({ orderId: ORDER })).toBe(0);
    expect(await stockOf(stocks, '1')).toEqual({ onHand: 10, reserved: 3 });
  });
});

describe('ReservationsForOrderService — 부분 실패', () => {
  it('한 예약의 재고가 없어 실패해도 나머지는 처리된다', async () => {
    // 재고 행을 지워 한쪽만 실패시킨다.
    const { service, stocks, reservations } = await build();
    const orphan = Reservation.create({
      id: ReservationId.of(reservationUuid('9')),
      skuId: SkuId.of(skuUuid('9')),
      orderId: OrderId.of(ORDER),
      quantity: Quantity.of(1),
      now: FIXED_NOW,
      ttl: RESERVATION_TTL,
    });
    orphan.pullEvents();
    await reservations.save(orphan);

    // SKU 9의 재고 행이 없으므로 그 예약만 실패한다.
    expect(await service.confirm({ orderId: ORDER })).toBe(2);
    expect(await stockOf(stocks, '1')).toEqual({ onHand: 7, reserved: 0 });
  });
});
