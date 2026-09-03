export interface ReleaseReservationCommand {
  readonly reservationId: string;
}

/** 확정과 같은 이유로 멱등하다. */
export interface ReleaseReservationUseCase {
  execute(command: ReleaseReservationCommand): Promise<void>;
}

export const RELEASE_RESERVATION_USECASE = Symbol('ReleaseReservationUseCase');
