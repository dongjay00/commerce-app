export interface AddItemToCartCommand {
  readonly customerId: string;
  readonly skuId: string;
  readonly quantity: number;
}

export interface AddItemToCartUseCase {
  execute(command: AddItemToCartCommand): Promise<void>;
}

export const ADD_ITEM_TO_CART_USECASE = Symbol('AddItemToCartUseCase');
