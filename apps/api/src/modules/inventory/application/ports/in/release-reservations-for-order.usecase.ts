export interface ReleaseReservationsForOrderCommand {
  readonly orderId: string;
}

export interface ReleaseReservationsForOrderUseCase {
  /** 실제로 처리한 예약 건수. 0이면 이미 전부 처리됐다는 뜻이다. */
  execute(command: ReleaseReservationsForOrderCommand): Promise<number>;
}

export const RELEASE_RESERVATIONS_FOR_ORDER_USECASE = Symbol('ReleaseReservationsForOrderUseCase');
