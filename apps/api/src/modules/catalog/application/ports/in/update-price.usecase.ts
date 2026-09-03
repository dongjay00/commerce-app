import type { MoneyDto } from '../../../../../shared/kernel/money';

export interface UpdatePriceCommand {
  readonly productId: string;
  readonly skuId: string;
  readonly price: MoneyDto;
}

export interface UpdatePriceUseCase {
  execute(command: UpdatePriceCommand): Promise<void>;
}

export const UPDATE_PRICE_USECASE = Symbol('UpdatePriceUseCase');
