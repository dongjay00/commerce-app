export interface RegisterStockCommand {
  readonly skuId: string;
  readonly onHand: number;
}

export interface RegisterStockUseCase {
  execute(command: RegisterStockCommand): Promise<void>;
}

export const REGISTER_STOCK_USECASE = Symbol('RegisterStockUseCase');
