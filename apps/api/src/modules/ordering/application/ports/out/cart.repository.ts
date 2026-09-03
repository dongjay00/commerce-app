import type { CartId, CustomerId } from '../../../../../shared/kernel/identifiers';
import type { TransactionContext } from '../../../../../shared/kernel/ports/transaction-manager';
import type { Cart } from '../../../domain/cart/cart';

export interface CartRepository {
  /** 고객당 장바구니는 하나다 — `carts.customer_id`가 유니크다. */
  findByCustomerId(customerId: CustomerId, tx?: TransactionContext): Promise<Cart | null>;
  save(cart: Cart, tx?: TransactionContext): Promise<void>;
  /** 주문이 만들어지면 장바구니를 지운다(태스크 12). 없으면 조용히 넘어간다. */
  delete(cartId: CartId, tx?: TransactionContext): Promise<void>;
}

export const CART_REPOSITORY = Symbol('CartRepository');
