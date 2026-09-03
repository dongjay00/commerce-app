export interface RestockCommand {
  readonly skuId: string;
  readonly quantity: number;
}

export interface RestockUseCase {
  execute(command: RestockCommand): Promise<void>;
}

export const RESTOCK_USECASE = Symbol('RestockUseCase');
