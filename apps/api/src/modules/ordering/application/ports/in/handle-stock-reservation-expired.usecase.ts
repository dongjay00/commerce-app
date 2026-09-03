export interface HandleStockReservationExpiredCommand {
  readonly orderId: string;
}

export interface HandleStockReservationExpiredUseCase {
  /** 주문을 실패 처리했으면 `true`. 이미 결말이 난 주문이면 `false`. */
  execute(command: HandleStockReservationExpiredCommand): Promise<boolean>;
}

export const HANDLE_STOCK_RESERVATION_EXPIRED_USECASE = Symbol(
  'HandleStockReservationExpiredUseCase',
);
