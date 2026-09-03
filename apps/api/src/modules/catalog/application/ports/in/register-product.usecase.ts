import type { MoneyDto } from '../../../../../shared/kernel/money';

export interface RegisterProductCommand {
  readonly name: string;
  readonly skus: ReadonlyArray<{ readonly code: string; readonly price: MoneyDto }>;
}

export interface RegisterProductUseCase {
  execute(command: RegisterProductCommand): Promise<{ productId: string }>;
}

export const REGISTER_PRODUCT_USECASE = Symbol('RegisterProductUseCase');
