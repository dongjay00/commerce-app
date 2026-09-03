import { AggregateRoot } from '../../../shared/kernel/aggregate-root';
import type { Duration } from '../../../shared/kernel/duration';
import type { OrderId, ReservationId, SkuId } from '../../../shared/kernel/identifiers';
import type { Quantity } from '../../../shared/kernel/quantity';
import { ReservationConflictError } from './stock.errors';
import { stockReservationExpired } from './stock.events';

export type ReservationStatus = 'PENDING' | 'CONFIRMED' | 'RELEASED' | 'EXPIRED' | 'RESTORED';

/**
 * 예약 애그리거트 루트.
 *
 * **`StockItem` 안이 아니라 자기 루트다** — 만료 스케줄러가 `expires_at`으로 SKU를
 * 가로질러 전역 스캔해야 하기 때문이다(스펙 §10.8). `stock_items.reserved`는 같은
 * 트랜잭션에서 함께 갱신되는 비정규화 카운터이고, 지켜야 할 불변식(`available ≥ 0`)은
 * 여전히 `StockItem` 하나에 있다.
 *
 * **전이 메서드는 `boolean`을 돌려준다.** Outbox는 at-least-once라 `OrderPaid`가 두 번
 * 배달될 수 있고(스펙 §6.3), 그러면 `confirm`이 두 번 불린다. 두 번째는 아무것도 하지
 * 않고 `false`를 돌려주며, 유스케이스는 그 값으로 재고 카운터를 또 건드릴지 결정한다.
 * 되돌릴 수 없는 상태에서의 전이는 진짜 충돌이므로 던진다.
 *
 * | 현재 | `confirm` | `release` | `expire` | `restore` |
 * |---|---|---|---|---|
 * | PENDING | → CONFIRMED, `true` | → RELEASED, `true` | → EXPIRED, `true` + 이벤트 | **던진다** |
 * | CONFIRMED | `false` (멱등) | **던진다** | `false` | → RESTORED, `true` |
 * | RELEASED | **던진다** | `false` (멱등) | `false` | **던진다** |
 * | EXPIRED | **던진다** | `false` | `false` | **던진다** |
 * | RESTORED | **던진다** | **던진다** | `false` | `false` (멱등) |
 *
 * `RESTORED`는 계획 4가 더한 상태다 — PAID 주문을 취소하면 예약은 이미 `CONFIRMED`이고
 * 재고는 `onHand`에서 차감됐다. "해제"가 아니라 "되돌리기"이고, 계획 3의 전이표에서
 * `CONFIRMED`는 종착점이었다.
 */
export class Reservation extends AggregateRoot {
  private constructor(
    readonly id: ReservationId,
    readonly skuId: SkuId,
    readonly orderId: OrderId,
    readonly quantity: Quantity,
    private statusValue: ReservationStatus,
    readonly expiresAt: Date,
    readonly createdAt: Date,
  ) {
    super();
  }

  static create(params: {
    id: ReservationId;
    skuId: SkuId;
    orderId: OrderId;
    quantity: Quantity;
    now: Date;
    ttl: Duration;
  }): Reservation {
    return new Reservation(
      params.id,
      params.skuId,
      params.orderId,
      params.quantity,
      'PENDING',
      new Date(params.now.getTime() + params.ttl.millis),
      params.now,
    );
  }

  static rehydrate(params: {
    id: ReservationId;
    skuId: SkuId;
    orderId: OrderId;
    quantity: Quantity;
    status: ReservationStatus;
    expiresAt: Date;
    createdAt: Date;
  }): Reservation {
    return new Reservation(
      params.id,
      params.skuId,
      params.orderId,
      params.quantity,
      params.status,
      params.expiresAt,
      params.createdAt,
    );
  }

  get status(): ReservationStatus {
    return this.statusValue;
  }

  /** 만료 경계는 반열린 구간이다 — `expiresAt` 정각은 이미 만료다. */
  isExpiredAt(now: Date): boolean {
    return now.getTime() >= this.expiresAt.getTime();
  }

  confirm(_now: Date): boolean {
    if (this.statusValue === 'CONFIRMED') {
      return false; // 멱등: 이벤트가 두 번 배달됐다
    }
    if (this.statusValue !== 'PENDING') {
      // 해제·만료된 예약을 확정하면 재고가 이미 돌아간 뒤라 초과 판매가 된다.
      throw new ReservationConflictError(this.id, this.statusValue, 'CONFIRMED');
    }
    this.statusValue = 'CONFIRMED';
    return true;
  }

  release(_now: Date): boolean {
    if (this.statusValue === 'RELEASED' || this.statusValue === 'EXPIRED') {
      return false; // 멱등: 만료가 이미 해제를 했거나 중복 배달이다
    }
    if (this.statusValue !== 'PENDING') {
      throw new ReservationConflictError(this.id, this.statusValue, 'RELEASED');
    }
    this.statusValue = 'RELEASED';
    return true;
  }

  expire(now: Date): boolean {
    if (this.statusValue !== 'PENDING') {
      // 결제가 끝난 예약을 TTL이 뒤늦게 만료시키면 재고가 두 번 돌아가고
      // Ordering이 성공한 주문을 실패 처리한다. 조용히 넘어간다.
      return false;
    }
    this.statusValue = 'EXPIRED';
    this.raise(stockReservationExpired(this, now));
    return true;
  }
  /**
   * 확정된 예약을 되돌린다. 호출자가 `StockItem.restore`를 함께 부른다.
   *
   * `CONFIRMED`에서만 가능하다. `PENDING` 예약을 복원하려는 것은 사가가 순서를
   * 잃었다는 뜻이고(확정 전인데 환불이 왔다), 조용히 넘기면 그 사실이 드러나지 않는다.
   */
  restore(_now: Date): boolean {
    if (this.statusValue === 'RESTORED') {
      return false;
    }
    if (this.statusValue !== 'CONFIRMED') {
      throw new ReservationConflictError(this.id, this.statusValue, 'RESTORED');
    }
    this.statusValue = 'RESTORED';
    return true;
  }
}
