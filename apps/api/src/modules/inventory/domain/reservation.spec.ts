import { describe, expect, it } from 'vitest';
import { Duration } from '../../../shared/kernel/duration';
import { OrderId, ReservationId, SkuId } from '../../../shared/kernel/identifiers';
import { Quantity } from '../../../shared/kernel/quantity';
import { Reservation, type ReservationStatus } from './reservation';
import { ReservationConflictError } from './stock.errors';
import { STOCK_RESERVATION_EXPIRED } from './stock.events';

const ID = ReservationId.of('018f2b1c-4a5d-7e6f-8a9b-0c1d5e000001');
const SKU = SkuId.of('018f2b1c-4a5d-7e6f-8a9b-0c1d5c000001');
const ORDER = OrderId.of('018f2b1c-4a5d-7e6f-8a9b-0c1d0e000001');
const NOW = new Date('2026-03-01T10:00:00.000Z');
const TTL = Duration.minutes(15);

function pending(): Reservation {
  return Reservation.create({
    id: ID,
    skuId: SKU,
    orderId: ORDER,
    quantity: Quantity.of(3),
    now: NOW,
    ttl: TTL,
  });
}

function inState(status: ReservationStatus): Reservation {
  return Reservation.rehydrate({
    id: ID,
    skuId: SKU,
    orderId: ORDER,
    quantity: Quantity.of(3),
    status,
    expiresAt: new Date(NOW.getTime() + TTL.millis),
    createdAt: NOW,
  });
}

describe('Reservation.create', () => {
  it('PENDING으로 시작하고 만료 시각을 TTL로 계산한다', () => {
    const reservation = pending();
    expect(reservation.status).toBe('PENDING');
    expect(reservation.expiresAt).toEqual(new Date(NOW.getTime() + TTL.millis));
    expect(reservation.createdAt).toEqual(NOW);
  });

  it('이벤트를 쌓지 않는다', () => {
    expect(pending().hasUncommittedEvents).toBe(false);
  });
});

describe('Reservation.isExpiredAt', () => {
  it('만료 직전에는 살아 있다', () => {
    const reservation = pending();
    expect(reservation.isExpiredAt(new Date(reservation.expiresAt.getTime() - 1))).toBe(false);
  });

  it('만료 시각 정각은 이미 만료다', () => {
    // 반열린 구간이다. 경계를 닫으면 TTL이 1밀리초 길어지고, 그 차이가
    // 만료 스캔 쿼리(expires_at <= now)와 어긋난다.
    const reservation = pending();
    expect(reservation.isExpiredAt(reservation.expiresAt)).toBe(true);
  });
});

describe('Reservation.confirm', () => {
  it('PENDING이면 확정하고 true를 돌려준다', () => {
    const reservation = pending();
    expect(reservation.confirm(NOW)).toBe(true);
    expect(reservation.status).toBe('CONFIRMED');
  });

  it('두 번 부르면 두 번째는 false이고 상태가 그대로다', () => {
    // Outbox는 at-least-once라 OrderPaid가 두 번 배달되는 것이 정상이다(스펙 §6.3).
    // 두 번째가 던지면 정상 동작하는 시스템에서 주문 하나가 실패한다.
    const reservation = pending();
    reservation.confirm(NOW);
    expect(reservation.confirm(NOW)).toBe(false);
    expect(reservation.status).toBe('CONFIRMED');
  });

  it('RELEASED인 예약을 확정하면 ReservationConflictError다', () => {
    expect(() => inState('RELEASED').confirm(NOW)).toThrow(ReservationConflictError);
  });

  it('EXPIRED인 예약을 확정하면 ReservationConflictError다', () => {
    // TTL이 이미 재고를 돌려줬는데 확정하면 초과 판매가 된다.
    expect(() => inState('EXPIRED').confirm(NOW)).toThrow(ReservationConflictError);
  });
});

describe('Reservation.release', () => {
  it('PENDING이면 해제하고 true를 돌려준다', () => {
    const reservation = pending();
    expect(reservation.release(NOW)).toBe(true);
    expect(reservation.status).toBe('RELEASED');
  });

  it('두 번 부르면 두 번째는 false다', () => {
    const reservation = pending();
    reservation.release(NOW);
    expect(reservation.release(NOW)).toBe(false);
  });

  it('CONFIRMED인 예약을 해제하면 ReservationConflictError다', () => {
    // 이미 나간 재고를 되돌릴 수는 없다.
    expect(() => inState('CONFIRMED').release(NOW)).toThrow(ReservationConflictError);
  });

  it('EXPIRED인 예약을 해제하면 false다 — 만료가 이미 해제했다', () => {
    expect(inState('EXPIRED').release(NOW)).toBe(false);
  });
});

describe('Reservation.expire', () => {
  it('PENDING이면 만료하고 StockReservationExpired를 쌓는다', () => {
    const reservation = pending();
    expect(reservation.expire(NOW)).toBe(true);
    expect(reservation.status).toBe('EXPIRED');

    const [event, ...rest] = reservation.pullEvents();
    expect(rest).toHaveLength(0);
    expect(event).toMatchObject({
      eventType: STOCK_RESERVATION_EXPIRED,
      aggregateType: 'Reservation',
      aggregateId: ID,
      occurredAt: NOW,
    });
  });

  it('이벤트 payload는 JSON 직렬화 가능한 원시 값만 담는다', () => {
    // outbox의 payload 컬럼이 JsonB다. 값 객체를 그대로 넣으면 직렬화가 {}가 되어
    // 조용히 빈 이벤트가 발행된다.
    const reservation = pending();
    reservation.expire(NOW);
    const [event] = reservation.pullEvents();
    expect(event?.payload).toEqual({
      reservationId: ID,
      skuId: SKU,
      orderId: ORDER,
      quantity: 3,
    });
    expect(JSON.parse(JSON.stringify(event?.payload))).toEqual(event?.payload);
  });

  it('두 번 부르면 두 번째는 false이고 이벤트를 또 쌓지 않는다', () => {
    const reservation = pending();
    reservation.expire(NOW);
    reservation.pullEvents();
    expect(reservation.expire(NOW)).toBe(false);
    expect(reservation.hasUncommittedEvents).toBe(false);
  });

  it('CONFIRMED인 예약은 만료되지 않고 이벤트도 없다', () => {
    // 결제가 끝난 예약을 만료 이벤트로 알리면 Ordering이 성공한 주문을 실패 처리한다.
    const reservation = inState('CONFIRMED');
    expect(reservation.expire(NOW)).toBe(false);
    expect(reservation.status).toBe('CONFIRMED');
    expect(reservation.hasUncommittedEvents).toBe(false);
  });
});

describe('Reservation.rehydrate', () => {
  it('저장된 상태를 그대로 복원하고 이벤트를 쌓지 않는다', () => {
    const reservation = inState('CONFIRMED');
    expect(reservation.status).toBe('CONFIRMED');
    expect(reservation.hasUncommittedEvents).toBe(false);
  });
});

describe('Reservation.restore — 계획 4의 확장', () => {
  it('CONFIRMED 예약을 RESTORED로 되돌린다', () => {
    // PAID 주문 취소는 "해제"가 아니라 "되돌리기"다 — 재고가 이미 차감됐다.
    const reservation = pending();
    reservation.confirm(NOW);

    expect(reservation.restore(NOW)).toBe(true);
    expect(reservation.status).toBe('RESTORED');
  });

  it('두 번 복원하면 false다', () => {
    // OrderCancelled가 at-least-once로 배달된다. 막지 못하면 재고가 두 번 늘어나고
    // 팔 수 있는 수량이 실제보다 많아져 초과 판매로 이어진다.
    const reservation = pending();
    reservation.confirm(NOW);
    reservation.restore(NOW);

    expect(reservation.restore(NOW)).toBe(false);
  });

  it('PENDING 예약은 복원할 수 없다', () => {
    // 확정 전인데 환불이 왔다는 것은 사가가 순서를 잃었다는 뜻이다.
    expect(() => pending().restore(NOW)).toThrow(ReservationConflictError);
  });

  it('RELEASED 예약은 복원할 수 없다', () => {
    const reservation = pending();
    reservation.release(NOW);
    expect(() => reservation.restore(NOW)).toThrow(ReservationConflictError);
  });

  it('RESTORED 예약에 만료가 와도 조용히 false다', () => {
    // 만료 스캔은 PENDING만 찾으므로 도달하지 않지만, 도달해도 이미 결말이 났다.
    const reservation = pending();
    reservation.confirm(NOW);
    reservation.restore(NOW);

    expect(reservation.expire(NOW)).toBe(false);
  });

  it('RESTORED 예약은 다시 확정할 수 없다', () => {
    const reservation = pending();
    reservation.confirm(NOW);
    reservation.restore(NOW);

    expect(() => reservation.confirm(NOW)).toThrow(ReservationConflictError);
  });
});
