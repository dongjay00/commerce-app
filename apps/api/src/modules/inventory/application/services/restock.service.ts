import { SkuId } from '../../../../shared/kernel/identifiers';
import type { TransactionManager } from '../../../../shared/kernel/ports/transaction-manager';
import { Quantity } from '../../../../shared/kernel/quantity';
import type { RestockCommand, RestockUseCase } from '../ports/in/restock.usecase';
import type { StockRepository } from '../ports/out/stock.repository';

/**
 * 보유량을 늘린다. `reserved`는 건드리지 않는다 — 입고와 예약은 다른 사건이다.
 *
 * `Quantity.positive`를 쓴다. 0 입고는 아무 일도 하지 않으면서 성공을 돌려주는
 * 요청이고, 그것은 호출자의 실수일 가능성이 높다.
 */
export class RestockService implements RestockUseCase {
  constructor(
    private readonly stocks: StockRepository,
    private readonly transactions: TransactionManager,
  ) {}

  async execute(command: RestockCommand): Promise<void> {
    const skuId = SkuId.of(command.skuId);
    const quantity = Quantity.positive(command.quantity);
    await this.transactions.run((tx) =>
      this.stocks.mutate(skuId, tx, (stock) => stock.restock(quantity)),
    );
  }
}
