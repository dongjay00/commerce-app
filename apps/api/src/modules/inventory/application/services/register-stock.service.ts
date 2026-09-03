import { SkuId } from '../../../../shared/kernel/identifiers';
import type { TransactionManager } from '../../../../shared/kernel/ports/transaction-manager';
import { Quantity } from '../../../../shared/kernel/quantity';
import { StockItem } from '../../domain/stock-item';
import type {
  RegisterStockCommand,
  RegisterStockUseCase,
} from '../ports/in/register-stock.usecase';
import type { StockRepository } from '../ports/out/stock.repository';

/**
 * SKU에 재고 행을 처음 만든다.
 *
 * 재고 행이 없으면 `ReserveStock`이 `StockNotFoundError`를 낸다. 계획 4의 E2E가
 * "상품 등록 → 재고 등록 → 주문"을 밟으려면 이 유스케이스가 있어야 한다.
 *
 * `Quantity.of`를 쓴다 — 0으로 등록하는 것은 정상이다(품절 상태로 상품을 열어두는 경우).
 * 입고(`Restock`)와 다른 점이다.
 */
export class RegisterStockService implements RegisterStockUseCase {
  constructor(
    private readonly stocks: StockRepository,
    private readonly transactions: TransactionManager,
  ) {}

  async execute(command: RegisterStockCommand): Promise<void> {
    const stock = StockItem.create({
      skuId: SkuId.of(command.skuId),
      onHand: Quantity.of(command.onHand),
    });
    // 이미 있으면 어댑터가 StockAlreadyExistsError로 번역해 던진다.
    await this.transactions.run((tx) => this.stocks.create(stock, tx));
  }
}
