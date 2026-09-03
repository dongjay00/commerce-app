import type { OrderId, ReservationId } from '../../../../../shared/kernel/identifiers';
import type { TransactionContext } from '../../../../../shared/kernel/ports/transaction-manager';
import type { Reservation } from '../../../domain/reservation';

export interface ReservationRepository {
  findById(id: ReservationId, tx?: TransactionContext): Promise<Reservation | null>;

  /**
   * 한 주문의 모든 예약. `reservations.order_id` 인덱스가 이것을 지원한다.
   *
   * **상태와 무관하게 전부 돌려준다** — 필터링은 유스케이스의 몫이다.
   *
   * 이벤트가 실어 나르는 것은 `orderId`다 — `OrderPaid`에 예약 ID 목록을 넣으려면
   * `Order`가 Inventory의 내부 식별자를 들어야 하고, 그것은 Core 애그리거트에
   * 다른 컨텍스트를 박는 결합이다.
   */
  findByOrderId(orderId: OrderId, tx?: TransactionContext): Promise<Reservation[]>;
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
