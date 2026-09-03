import type { CartId, CustomerId } from '../../../shared/kernel/identifiers';
import type { TransactionContext } from '../../../shared/kernel/ports/transaction-manager';
import type { CartRepository } from '../application/ports/out/cart.repository';
import { Cart } from '../domain/cart/cart';
import { CartLine } from '../domain/cart/cart-line';

/**
 * 단위 테스트용 CartRepository.
 *
 * **저장할 때 복사한다.** 저장본을 그대로 넘기면 호출자가 나중에 그 객체를 바꿨을 때
 * 저장소가 조용히 따라 바뀌어, 진짜 DB에서는 절대 일어나지 않는 일이 통과한다.
 */
export class InMemoryCartRepository implements CartRepository {
  private readonly byCustomer = new Map<string, Cart>();

  async findByCustomerId(customerId: CustomerId, _tx?: TransactionContext): Promise<Cart | null> {
    const found = this.byCustomer.get(customerId);
    return found === undefined ? null : InMemoryCartRepository.copy(found);
  }

  async save(cart: Cart, _tx?: TransactionContext): Promise<void> {
    this.byCustomer.set(cart.customerId, InMemoryCartRepository.copy(cart));
  }

  async delete(cartId: CartId, _tx?: TransactionContext): Promise<void> {
    for (const [customerId, cart] of this.byCustomer.entries()) {
      if (cart.id === cartId) {
        this.byCustomer.delete(customerId);
        return;
      }
    }
  }

  private static copy(cart: Cart): Cart {
    return Cart.rehydrate({
      id: cart.id,
      customerId: cart.customerId,
      lines: cart.lines.map((line) => new CartLine(line.skuId, line.quantity)),
    });
  }
}
