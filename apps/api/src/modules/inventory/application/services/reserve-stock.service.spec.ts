import { describe, expect, it } from 'vitest';
import { SkuId } from '../../../../shared/kernel/identifiers';
import { Quantity, QuantityBelowMinimumError } from '../../../../shared/kernel/quantity';
import { MutableClock } from '../../../../shared/testing/mutable-clock';
import { PassthroughTransactionManager } from '../../../../shared/testing/passthrough-transaction-manager';
import { SequentialIdGenerator } from '../../../../shared/testing/sequential-id-generator';
import { InsufficientStockError, StockNotFoundError } from '../../domain/stock.errors';
import { StockItem } from '../../domain/stock-item';
import { InMemoryReservationRepository } from '../../testing/in-memory-reservation.repository';
import { InMemoryStockRepository } from '../../testing/in-memory-stock.repository';
import { FIXED_NOW, orderUuid, RESERVATION_TTL, skuUuid } from '../../testing/inventory.fixtures';
import { ReserveStockService } from './reserve-stock.service';

const SKU = skuUuid('1');
const ORDER = orderUuid('1');

async function build(onHand = 10) {
  const stocks = new InMemoryStockRepository();
  const reservations = new InMemoryReservationRepository();
  const clock = new MutableClock(FIXED_NOW);
  const service = new ReserveStockService(
    stocks,
    reservations,
    new PassthroughTransactionManager(),
    clock,
    new SequentialIdGenerator(),
    RESERVATION_TTL,
  );
  await stocks.create(StockItem.create({ skuId: SkuId.of(SKU), onHand: Quantity.of(onHand) }));
  return { service, stocks, reservations, clock };
}

describe('ReserveStockService', () => {
  it('예약이 저장되고 재고 카운터가 늘어난다', async () => {
    const { service, stocks, reservations } = await build();
    const { reservationId } = await service.execute({ skuId: SKU, orderId: ORDER, quantity: 3 });

    // 저장본을 다시 읽어 확인한다 — 메모리 인스턴스만 보면 save를 빠뜨려도 통과한다.
    expect((await stocks.findBySkuId(SkuId.of(SKU)))?.reserved.value).toBe(3);
    const saved = await reservations.findById(reservationId as never);
    expect(saved?.status).toBe('PENDING');
    expect(saved?.quantity.value).toBe(3);
  });

  it('expiresAt이 주입된 Clock + 주입된 TTL이다', async () => {
    const { service } = await build();
    const { expiresAt } = await service.execute({ skuId: SKU, orderId: ORDER, quantity: 1 });
    expect(expiresAt).toEqual(new Date(FIXED_NOW.getTime() + RESERVATION_TTL.millis));
  });

  it('reservationId가 주입된 IdGenerator에서 나온다', async () => {
    const { service } = await build();
    const { reservationId } = await service.execute({ skuId: SKU, orderId: ORDER, quantity: 1 });
    expect(reservationId).toBe('00000000-0000-7000-8000-000000000001');
  });

  it('재고 부족이면 InsufficientStockError이고 예약 행이 하나도 저장되지 않는다', async () => {
    const { service, stocks, reservations } = await build(2);
    await expect(service.execute({ skuId: SKU, orderId: ORDER, quantity: 5 })).rejects.toThrow(
      InsufficientStockError,
    );

    expect((await stocks.findBySkuId(SkuId.of(SKU)))?.reserved.value).toBe(0);
    expect(await reservations.findExpired(new Date(Date.now() + 1e9), 100)).toEqual([]);
  });

  it('수량 0이면 QuantityBelowMinimumError이고 아무것도 저장되지 않는다', async () => {
    const { service, stocks } = await build();
    await expect(service.execute({ skuId: SKU, orderId: ORDER, quantity: 0 })).rejects.toThrow(
      QuantityBelowMinimumError,
    );
    expect((await stocks.findBySkuId(SkuId.of(SKU)))?.reserved.value).toBe(0);
  });

  it('없는 SKU면 StockNotFoundError다', async () => {
    const { service } = await build();
    await expect(
      service.execute({ skuId: skuUuid('9999'), orderId: ORDER, quantity: 1 }),
    ).rejects.toThrow(StockNotFoundError);
  });

  it('가용 재고를 정확히 다 쓰는 예약은 성공한다', async () => {
    const { service, stocks } = await build(3);
    await service.execute({ skuId: SKU, orderId: ORDER, quantity: 3 });
    expect((await stocks.findBySkuId(SkuId.of(SKU)))?.available.value).toBe(0);
  });
});
