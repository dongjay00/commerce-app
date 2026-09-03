import { describe, expect, it } from 'vitest';
import { SkuId } from '../../../../shared/kernel/identifiers';
import { Quantity } from '../../../../shared/kernel/quantity';
import { StockNotFoundError } from '../../domain/stock.errors';
import { StockItem } from '../../domain/stock-item';
import { InMemoryStockRepository } from '../../testing/in-memory-stock.repository';
import { skuUuid } from '../../testing/inventory.fixtures';
import { GetStockService } from './get-stock.service';

const SKU = skuUuid('1');

describe('GetStockService', () => {
  it('보유량·예약량·가용량을 돌려준다', async () => {
    const stocks = new InMemoryStockRepository();
    const stock = StockItem.create({ skuId: SkuId.of(SKU), onHand: Quantity.of(10) });
    stock.reserve(Quantity.of(3));
    await stocks.create(stock);

    const view = await new GetStockService(stocks).execute({ skuId: SKU });

    // available은 저장된 컬럼이 아니라 파생값이다 — 그래서 읽기 포트가 따로 없다.
    expect(view).toEqual({ skuId: SKU, onHand: 10, reserved: 3, available: 7 });
  });

  it('재고 행이 없으면 StockNotFoundError다', async () => {
    await expect(
      new GetStockService(new InMemoryStockRepository()).execute({ skuId: SKU }),
    ).rejects.toThrow(StockNotFoundError);
  });
});
