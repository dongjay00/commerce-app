import { DomainError } from '../../../shared/kernel/domain-error';
import type { SkuId } from '../../../shared/kernel/identifiers';
import type { Quantity } from '../../../shared/kernel/quantity';

/**
 * 가용 재고보다 많이 예약하려 했다. **정상적인 경합 결과다** — 인기 상품에서
 * 동시 주문이 몰리면 대부분의 요청이 이것으로 끝나는 것이 옳은 동작이다.
 * 그래서 `DomainError`이고 409로 나간다.
 *
 * 요청량과 가용량을 함께 담는 이유: 프론트가 "3개 요청하셨지만 1개 남았습니다"를
 * 보여주려면 둘 다 필요하고, 메시지 문자열을 파싱하게 만들면 안 된다.
 */
export class InsufficientStockError extends DomainError {
  static readonly CODE = 'INSUFFICIENT_STOCK';
  readonly code = InsufficientStockError.CODE;

  constructor(
    readonly skuId: SkuId,
    readonly requested: Quantity,
    readonly available: Quantity,
  ) {
    super(`재고가 부족합니다: ${requested.value}개 요청, ${available.value}개 가용`);
  }
}

/**
 * 되돌릴 수 없는 상태의 예약에 확정이나 해제를 시도했다.
 *
 * 이벤트 재배달로 인한 중복 호출은 이 예외가 아니라 no-op으로 처리된다 —
 * `Reservation`의 전이 메서드가 `false`를 돌려준다. 이 예외는 진짜 충돌
 * (이미 확정된 예약을 해제하려는 등)에만 쓴다.
 */
export class ReservationConflictError extends DomainError {
  static readonly CODE = 'RESERVATION_CONFLICT';
  readonly code = ReservationConflictError.CODE;

  constructor(reservationId: string, from: string, to: string) {
    super(`예약 ${reservationId}을(를) ${from}에서 ${to}(으)로 바꿀 수 없습니다.`);
  }
}

/**
 * 확정·해제하려는 수량이 예약된 수량보다 크다. 예약 행과 `stock_items.reserved`
 * 카운터가 어긋났다는 뜻이고, 편차 4가 감수하기로 한 비정규화의 대가가 드러난
 * 자리다. 사용자가 고칠 수 없으므로 `DomainError`가 아니다 — 500이 정직하다.
 *
 * `Quantity.minus`에 맡기지 않는 이유가 이것이다: 그쪽은 `NegativeQuantityError`
 * (409, 사용자가 만들 수 있는 충돌)를 던지는데 여기서는 그 분류가 틀렸다.
 */
export class StockCounterMismatchError extends Error {
  constructor(skuId: string, reserved: number, requested: number) {
    super(`재고 카운터가 어긋났습니다 (${skuId}): 예약 ${reserved}개, 요청 ${requested}개`);
    this.name = 'StockCounterMismatchError';
  }
}

/** 저장된 재고 행이 `reserved > onHand`다. 정상 경로로는 불가능하다. */
export class CorruptedStockError extends Error {
  constructor(skuId: string, onHand: number, reserved: number) {
    super(`저장된 재고가 손상되었습니다 (${skuId}): 보유 ${onHand}개, 예약 ${reserved}개`);
    this.name = 'CorruptedStockError';
  }
}

/**
 * 그 SKU의 재고 행이 없다. 카탈로그에 SKU는 있는데 재고를 한 번도 등록하지 않은
 * 경우가 대부분이다. 사용자 입장에서는 살 수 없는 상품이므로 404다.
 */
export class StockNotFoundError extends DomainError {
  static readonly CODE = 'STOCK_NOT_FOUND';
  readonly code = StockNotFoundError.CODE;

  constructor(skuId: string) {
    super(`재고를 찾을 수 없습니다: ${skuId}`);
  }
}

/**
 * 그런 예약이 없다. 이벤트 핸들러가 없는 예약 ID를 받는 것은 정상 경로에서
 * 일어나지 않으므로, 이것이 나면 데이터가 어긋났거나 잘못된 요청이다.
 */
export class ReservationNotFoundError extends DomainError {
  static readonly CODE = 'RESERVATION_NOT_FOUND';
  readonly code = ReservationNotFoundError.CODE;

  constructor(reservationId: string) {
    super(`예약을 찾을 수 없습니다: ${reservationId}`);
  }
}
