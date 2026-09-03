import { describe, expect, it } from 'vitest';
import { SkuId } from '../../../../shared/kernel/identifiers';
import { Quantity, QuantityBelowMinimumError } from '../../../../shared/kernel/quantity';
import { PassthroughTransactionManager } from '../../../../shared/testing/passthrough-transaction-manager';
import { StockNotFoundError } from '../../domain/stock.errors';
import { StockItem } from '../../domain/stock-item';
import { InMemoryStockRepository } from '../../testing/in-memory-stock.repository';
import { skuUuid } from '../../testing/inventory.fixtures';
import { RestockService } from './restock.service';

const SKU = skuUuid('1');

async function build(onHand = 10, reserved = 0) {
  const stocks = new InMemoryStockRepository();
  const stock = StockItem.create({ skuId: SkuId.of(SKU), onHand: Quantity.of(onHand) });
  if (reserved > 0) {
    stock.reserve(Quantity.of(reserved));
  }
  await stocks.create(stock);
  return { stocks, service: new RestockService(stocks, new PassthroughTransactionManager()) };
}

describe('RestockService', () => {
  it('보유량을 늘린다', async () => {
    const { service, stocks } = await build(10);

    await service.execute({ skuId: SKU, quantity: 5 });

    expect((await stocks.findBySkuId(SkuId.of(SKU)))?.onHand.value).toBe(15);
  });

  it('입고는 reserved를 건드리지 않는다', async () => {
    // 입고와 예약은 다른 사건이다. 입고가 예약을 지우면 이미 잡아둔 주문이 풀린다.
    const { service, stocks } = await build(10, 4);

    await service.execute({ skuId: SKU, quantity: 5 });

    const stock = await stocks.findBySkuId(SkuId.of(SKU));
    expect(stock?.reserved.value).toBe(4);
    expect(stock?.available.value).toBe(11);
  });

  it('수량 0 입고는 QuantityBelowMinimumError다', async () => {
    // 아무 일도 하지 않으면서 성공을 돌려주는 요청은 호출자의 실수일 가능성이 높다.
    const { service } = await build();
    await expect(service.execute({ skuId: SKU, quantity: 0 })).rejects.toThrow(
      QuantityBelowMinimumError,
    );
  });

  it('없는 SKU에 입고하면 StockNotFoundError다', async () => {
    const { service } = await build();
    await expect(service.execute({ skuId: skuUuid('9'), quantity: 5 })).rejects.toThrow(
      StockNotFoundError,
    );
  });
});
