export interface RemoveItemFromCartCommand {
  readonly customerId: string;
  readonly skuId: string;
}

export interface RemoveItemFromCartUseCase {
  execute(command: RemoveItemFromCartCommand): Promise<void>;
}

export const REMOVE_ITEM_FROM_CART_USECASE = Symbol('RemoveItemFromCartUseCase');
