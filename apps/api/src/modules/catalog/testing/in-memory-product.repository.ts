import type { ProductId } from '../../../shared/kernel/identifiers';
import type { TransactionContext } from '../../../shared/kernel/ports/transaction-manager';
import type { ProductRepository } from '../application/ports/out/product.repository';
import { Product } from '../domain/product';
import { Sku } from '../domain/sku';

/**
 * 단위 테스트용 ProductRepository.
 *
 * **저장 시 복사한다.** 참조를 그대로 들고 있으면 저장 뒤 애그리거트를 바꾼 것이
 * 저장본에도 반영돼, 트랜잭션 롤백을 흉내낼 수 없고 계약의 "저장 후 원본을
 * 변경해도" 케이스가 무의미해진다.
 *
 * `Sku`는 불변이라 인스턴스를 공유해도 되지만 배열과 `Product`는 새로 만들어야 한다.
 */
export class InMemoryProductRepository implements ProductRepository {
  private readonly byId = new Map<string, Product>();

  async findById(id: ProductId, _tx?: TransactionContext): Promise<Product | null> {
    const stored = this.byId.get(id);
    return stored ? InMemoryProductRepository.copy(stored) : null;
  }

  async save(product: Product, _tx?: TransactionContext): Promise<void> {
    this.byId.set(product.id, InMemoryProductRepository.copy(product));
  }

  /** 조회 fake 전용. 포트에는 없는 메서드다 — in-memory 조회를 만들기 위한 것뿐이다. */
  async findAll(): Promise<Product[]> {
    return [...this.byId.values()].map(InMemoryProductRepository.copy);
  }

  private static copy(product: Product): Product {
    return Product.rehydrate({
      id: product.id,
      name: product.name,
      status: product.status,
      skus: product.skus.map((sku) =>
        Sku.rehydrate({ id: sku.id, code: sku.code, price: sku.price }),
      ),
      createdAt: new Date(product.createdAt.getTime()),
    });
  }
}
