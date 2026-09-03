import { OrderId, ReservationId, SkuId } from '../../../../../shared/kernel/identifiers';
import { Quantity } from '../../../../../shared/kernel/quantity';
import { Reservation, type ReservationStatus } from '../../../domain/reservation';

export interface ReservationRow {
  id: string;
  skuId: string;
  orderId: string;
  quantity: number;
  status: string;
  expiresAt: Date;
  createdAt: Date;
}

/**
 * 저장된 행 → 애그리거트.
 *
 * 식별자는 `fromPersistence`를 쓴다 — `.of`를 쓰면 깨진 행이 `InvalidIdError`(400)를
 * 내고 클라이언트에게 "당신 요청이 잘못됐다"고 거짓말한다 (계획 1의 M7).
 *
 * `quantity`는 `Quantity.of`(0 이상)를 쓴다. 예약은 1 이상이어야 하지만 `positive`를
 * 쓰면 실패가 `QuantityBelowMinimumError`(422, `DomainError`)가 되어 분류가 틀린다 —
 * 0짜리 예약 행이 저장돼 있다면 그건 사용자 입력 문제가 아니라 데이터 문제다.
 * `of`가 음수에 던지는 `InvalidQuantityError`는 일반 `Error`라 500으로 간다.
 */
export function toReservationDomain(row: ReservationRow): Reservation {
  return Reservation.rehydrate({
    id: ReservationId.fromPersistence(row.id),
    skuId: SkuId.fromPersistence(row.skuId),
    orderId: OrderId.fromPersistence(row.orderId),
    quantity: Quantity.of(row.quantity),
    status: row.status as ReservationStatus,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
  });
}

export function toReservationRow(reservation: Reservation): ReservationRow {
  return {
    id: reservation.id,
    skuId: reservation.skuId,
    orderId: reservation.orderId,
    quantity: reservation.quantity.value,
    status: reservation.status,
    expiresAt: reservation.expiresAt,
    createdAt: reservation.createdAt,
  };
}
