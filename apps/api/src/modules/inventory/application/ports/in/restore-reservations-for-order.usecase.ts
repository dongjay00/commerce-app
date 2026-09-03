export interface RestoreReservationsForOrderCommand {
  readonly orderId: string;
}

export interface RestoreReservationsForOrderUseCase {
  /** 실제로 처리한 예약 건수. 0이면 이미 전부 처리됐다는 뜻이다. */
  execute(command: RestoreReservationsForOrderCommand): Promise<number>;
}

export const RESTORE_RESERVATIONS_FOR_ORDER_USECASE = Symbol('RestoreReservationsForOrderUseCase');
