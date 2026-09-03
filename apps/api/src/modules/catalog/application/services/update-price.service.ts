import { ProductId, SkuId } from '../../../../shared/kernel/identifiers';
import { Money } from '../../../../shared/kernel/money';
import type { TransactionManager } from '../../../../shared/kernel/ports/transaction-manager';
import { ProductNotFoundError } from '../../domain/catalog.errors';
import { Price } from '../../domain/price';
import type { UpdatePriceCommand, UpdatePriceUseCase } from '../ports/in/update-price.usecase';
import type { ProductRepository } from '../ports/out/product.repository';

export class UpdatePriceService implements UpdatePriceUseCase {
  constructor(
    private readonly products: ProductRepository,
    private readonly transactions: TransactionManager,
  ) {}

  async execute(command: UpdatePriceCommand): Promise<void> {
    // 값 객체 생성이 먼저다. 0원처럼 성공할 수 없는 요청으로 트랜잭션을 열지 않는다.
    const productId = ProductId.of(command.productId);
    const skuId = SkuId.of(command.skuId);
    const price = Price.of(Money.fromDto(command.price));

    await this.transactions.run(async (tx) => {
      const product = await this.products.findById(productId, tx);
      if (product === null) {
        throw new ProductNotFoundError(productId);
      }
      product.changePrice(skuId, price); // 없는 SKU면 SkuNotFoundError
      await this.products.save(product, tx);
    });
  }
}
