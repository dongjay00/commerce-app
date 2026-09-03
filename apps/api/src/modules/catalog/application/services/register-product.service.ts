import { ProductId, SkuId } from '../../../../shared/kernel/identifiers';
import { Money } from '../../../../shared/kernel/money';
import type { Clock } from '../../../../shared/kernel/ports/clock';
import type { IdGenerator } from '../../../../shared/kernel/ports/id-generator';
import type { TransactionManager } from '../../../../shared/kernel/ports/transaction-manager';
import { Price } from '../../domain/price';
import { Product } from '../../domain/product';
import { Sku } from '../../domain/sku';
import type {
  RegisterProductCommand,
  RegisterProductUseCase,
} from '../ports/in/register-product.usecase';
import type { ProductRepository } from '../ports/out/product.repository';

export class RegisterProductService implements RegisterProductUseCase {
  constructor(
    private readonly products: ProductRepository,
    private readonly transactions: TransactionManager,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async execute(command: RegisterProductCommand): Promise<{ productId: string }> {
    // 값 객체 생성이 트랜잭션 밖이다 — 성공할 수 없는 요청 때문에 트랜잭션을 열지 않는다.
    const skus = command.skus.map((input) =>
      Sku.create({
        id: SkuId.of(this.ids.nextId()),
        code: input.code,
        price: Price.of(Money.fromDto(input.price)),
      }),
    );
    const product = Product.register({
      id: ProductId.of(this.ids.nextId()),
      name: command.name,
      skus,
      now: this.clock.now(),
    });

    await this.transactions.run(async (tx) => {
      await this.products.save(product, tx);
    });

    return { productId: product.id };
  }
}
