import type { ReservationId } from '../../../../../shared/kernel/identifiers';
import type { TransactionContext } from '../../../../../shared/kernel/ports/transaction-manager';
import type { Reservation } from '../../../domain/reservation';

export interface ReservationRepository {
  findById(id: ReservationId, tx?: TransactionContext): Promise<Reservation | null>;
  save(reservation: Reservation, tx?: TransactionContext): Promise<void>;

  /**
   * `expires_at <= now`이면서 아직 `PENDING`인 예약을 오래된 것부터 최대 `limit`개.
   *
   * TTL 자가치유가 이것을 스캔한다(스펙 §6.2의 5단계). `limit`이 있는 이유는
   * 스케줄러가 한 번에 처리할 양을 제한해야 하기 때문이다 — 장애 후 만료가 수만 건
   * 밀려 있을 때 한 트랜잭션에 다 넣으면 그 트랜잭션이 영원히 끝나지 않는다.
   */
  findExpired(now: Date, limit: number, tx?: TransactionContext): Promise<Reservation[]>;
}

export const RESERVATION_REPOSITORY = Symbol('ReservationRepository');
