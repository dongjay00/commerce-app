import type { SkuId } from '../../../shared/kernel/identifiers';
import type { TransactionContext } from '../../../shared/kernel/ports/transaction-manager';
import { Quantity } from '../../../shared/kernel/quantity';
import type { StockRepository } from '../application/ports/out/stock.repository';
import { StockAlreadyExistsError, StockNotFoundError } from '../domain/stock.errors';
import { StockItem } from '../domain/stock-item';

/**
 * 단위 테스트용 StockRepository. 잠금이 없다 — 순차 호출만 하는 계약 스위트에서는
 * 그것으로 충분하고, 동시성은 태스크 13이 진짜 Prisma 어댑터로 확인한다.
 *
 * **`mutate`는 복사본에 `change`를 적용한다.** 저장본을 그대로 넘기면 `change`가
 * 던졌을 때 부분 변경이 남아, 계약의 "change가 던지면 아무것도 저장되지 않는다"가
 * 거짓으로 통과한다.
 */
export class InMemoryStockRepository implements StockRepository {
  private readonly bySkuId = new Map<string, StockItem>();

  async mutate<T>(
    skuId: SkuId,
    _tx: TransactionContext,
    change: (stock: StockItem) => T,
  ): Promise<T> {
    const stored = this.bySkuId.get(skuId);
    if (stored === undefined) {
      throw new StockNotFoundError(skuId);
    }
    const working = InMemoryStockRepository.copy(stored);
    const result = change(working); // 던지면 여기서 빠져나가고 저장에 도달하지 않는다
    // working을 그대로 저장하면 안 된다 — change가 그것을 반환하는 경우(예약
    // 유스케이스가 그렇게 하지는 않지만 막을 수는 없다) 호출자가 저장본을 쥐게 되고,
    // 나중에 그것을 바꾸면 저장본이 따라 바뀐다.
    this.bySkuId.set(skuId, InMemoryStockRepository.copy(working));
    return result;
  }

  async findBySkuId(skuId: SkuId, _tx?: TransactionContext): Promise<StockItem | null> {
    const stored = this.bySkuId.get(skuId);
    return stored ? InMemoryStockRepository.copy(stored) : null;
  }

  async create(stock: StockItem, _tx?: TransactionContext): Promise<void> {
    if (this.bySkuId.has(stock.skuId)) {
      throw new StockAlreadyExistsError(stock.skuId);
    }
    this.bySkuId.set(stock.skuId, InMemoryStockRepository.copy(stock));
  }

  private static copy(stock: StockItem): StockItem {
    return StockItem.rehydrate({
      skuId: stock.skuId,
      onHand: Quantity.of(stock.onHand.value),
      reserved: Quantity.of(stock.reserved.value),
    });
  }
}
