export interface ReserveStockCommand {
  readonly skuId: string;
  readonly orderId: string;
  readonly quantity: number;
}

export interface ReserveStockUseCase {
  execute(command: ReserveStockCommand): Promise<{ reservationId: string; expiresAt: Date }>;
}

export const RESERVE_STOCK_USECASE = Symbol('ReserveStockUseCase');
