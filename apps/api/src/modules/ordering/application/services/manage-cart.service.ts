import { CartId, CustomerId, SkuId } from '../../../../shared/kernel/identifiers';
import type { IdGenerator } from '../../../../shared/kernel/ports/id-generator';
import type {
  TransactionContext,
  TransactionManager,
} from '../../../../shared/kernel/ports/transaction-manager';
import { Quantity } from '../../../../shared/kernel/quantity';
import { Cart } from '../../domain/cart/cart';
import { CartNotFoundError } from '../../domain/cart/cart.errors';
import type { AddItemToCartCommand } from '../ports/in/add-item-to-cart.usecase';
import type { ChangeCartItemQuantityCommand } from '../ports/in/change-cart-item-quantity.usecase';
import type { RemoveItemFromCartCommand } from '../ports/in/remove-item-from-cart.usecase';
import type { CartRepository } from '../ports/out/cart.repository';

/**
 * 장바구니 유스케이스 셋. 셋 다 "장바구니를 찾고, 애그리거트 메서드를 한 번 부르고,
 * 저장한다"는 같은 세 줄이라 한 서비스로 둔다 — 나누면 그 세 줄이 세 번 복제된다.
 * 포트는 셋으로 나눠 컨트롤러와 DI가 보는 표면을 유스케이스 단위로 유지한다.
 * 계획 2의 `ManageAddressesService`가 같은 판단을 했다.
 *
 * 세 유스케이스 인터페이스를 모두 구현하지만 메서드 이름이 다르므로
 * (`addItem`/`removeItem`/`changeQuantity`) 모듈이 얇은 객체 리터럴로 감싼다.
 */
export class ManageCartService {
  constructor(
    private readonly carts: CartRepository,
    private readonly transactions: TransactionManager,
    private readonly ids: IdGenerator,
  ) {}

  async addItem(command: AddItemToCartCommand): Promise<void> {
    // 값 객체 생성이 트랜잭션 밖이다 — 수량 0처럼 성공할 수 없는 요청으로 트랜잭션을
    // 열지 않고, 무엇보다 실패한 요청이 빈 장바구니를 남기지 않는다.
    const customerId = CustomerId.of(command.customerId);
    const skuId = SkuId.of(command.skuId);
    const quantity = Quantity.positive(command.quantity);

    await this.transactions.run(async (tx) => {
      const cart =
        (await this.carts.findByCustomerId(customerId, tx)) ??
        Cart.create({ id: CartId.of(this.ids.nextId()), customerId });
      cart.addItem(skuId, quantity);
      await this.carts.save(cart, tx);
    });
  }

  async removeItem(command: RemoveItemFromCartCommand): Promise<void> {
    const customerId = CustomerId.of(command.customerId);
    const skuId = SkuId.of(command.skuId);

    await this.transactions.run(async (tx) => {
      const cart = await this.requireCart(customerId, tx);
      cart.removeItem(skuId);
      await this.carts.save(cart, tx);
    });
  }

  async changeQuantity(command: ChangeCartItemQuantityCommand): Promise<void> {
    const customerId = CustomerId.of(command.customerId);
    const skuId = SkuId.of(command.skuId);
    const quantity = Quantity.positive(command.quantity);

    await this.transactions.run(async (tx) => {
      const cart = await this.requireCart(customerId, tx);
      cart.changeQuantity(skuId, quantity);
      await this.carts.save(cart, tx);
    });
  }

  private async requireCart(customerId: CustomerId, tx: TransactionContext): Promise<Cart> {
    const cart = await this.carts.findByCustomerId(customerId, tx);
    if (cart === null) {
      throw new CartNotFoundError(customerId);
    }
    return cart;
  }
}
