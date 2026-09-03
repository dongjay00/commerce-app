export interface ConfirmReservationsForOrderCommand {
  readonly orderId: string;
}

export interface ConfirmReservationsForOrderUseCase {
  /** 실제로 처리한 예약 건수. 0이면 이미 전부 처리됐다는 뜻이다. */
  execute(command: ConfirmReservationsForOrderCommand): Promise<number>;
}

export const CONFIRM_RESERVATIONS_FOR_ORDER_USECASE = Symbol('ConfirmReservationsForOrderUseCase');
