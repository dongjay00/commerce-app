export interface ChangeCartItemQuantityCommand {
  readonly customerId: string;
  readonly skuId: string;
  readonly quantity: number;
}

export interface ChangeCartItemQuantityUseCase {
  execute(command: ChangeCartItemQuantityCommand): Promise<void>;
}

export const CHANGE_CART_ITEM_QUANTITY_USECASE = Symbol('ChangeCartItemQuantityUseCase');
