export interface ConfirmReservationCommand {
  readonly reservationId: string;
}

/**
 * 멱등하다. Outbox는 at-least-once라 `OrderPaid`가 두 번 배달될 수 있고(스펙 §6.3),
 * 두 번째 호출은 재고 카운터를 건드리지 않고 조용히 끝난다.
 */
export interface ConfirmReservationUseCase {
  execute(command: ConfirmReservationCommand): Promise<void>;
}

export const CONFIRM_RESERVATION_USECASE = Symbol('ConfirmReservationUseCase');
