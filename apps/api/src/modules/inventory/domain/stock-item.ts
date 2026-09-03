import type { SkuId } from '../../../shared/kernel/identifiers';
import { Quantity } from '../../../shared/kernel/quantity';
import {
  CorruptedStockError,
  InsufficientStockError,
  StockCounterMismatchError,
} from './stock.errors';

/**
 * 재고 애그리거트 루트.
 *
 * **락 코드가 한 줄도 없다** (스펙 §6.4). 이 클래스가 아는 것은 `reserved ≤ onHand`
 * 하나뿐이고, 그 불변식을 동시 요청 사이에서 지키는 것은 리포지토리 어댑터의 일이다 —
 * 그래서 포트 하나에 어댑터가 셋(in-memory / 비관적 / 낙관적) 붙는다.
 *
 * `version` 필드가 없는 것도 같은 이유다. 낙관적 어댑터가 읽은 버전을 자기 클로저에
 * 붙잡아 두고 `UPDATE ... WHERE version = <붙잡은 값>`에 쓴다. 도메인은 그런 컬럼이
 * 있는지도 모르고, 그래야 두 어댑터가 같은 도메인 코드를 공유한다.
 *
 * `AggregateRoot`를 상속하지 않는다 — 재고 변경 자체를 구독하는 곳이 없다.
 * Inventory가 발행하는 유일한 이벤트는 `StockReservationExpired`이고 그것은
 * `Reservation`이 낸다.
 */
export class StockItem {
  private constructor(
    readonly skuId: SkuId,
    private onHandValue: Quantity,
    private reservedValue: Quantity,
  ) {}

  static create(params: { skuId: SkuId; onHand: Quantity }): StockItem {
    return new StockItem(params.skuId, params.onHand, Quantity.ZERO);
  }

  static rehydrate(params: { skuId: SkuId; onHand: Quantity; reserved: Quantity }): StockItem {
    if (params.reserved.isGreaterThan(params.onHand)) {
      throw new CorruptedStockError(params.skuId, params.onHand.value, params.reserved.value);
    }
    return new StockItem(params.skuId, params.onHand, params.reserved);
  }

  get onHand(): Quantity {
    return this.onHandValue;
  }

  get reserved(): Quantity {
    return this.reservedValue;
  }

  get available(): Quantity {
    return this.onHandValue.minus(this.reservedValue);
  }

  /** 예약은 차감이 아니다 — `onHand`는 그대로 두고 `reserved`만 늘린다. */
  reserve(quantity: Quantity): void {
    // 검사가 갱신보다 먼저다. 순서가 뒤집히면 실패한 예약이 재고를 갉아먹고,
    // 예약 행이 없으므로 TTL로도 회수되지 않는다.
    if (quantity.isGreaterThan(this.available)) {
      throw new InsufficientStockError(this.skuId, quantity, this.available);
    }
    this.reservedValue = this.reservedValue.plus(quantity);
  }

  /** 예약을 실제 차감으로 바꾼다. 보유량과 예약량이 함께 준다. */
  confirm(quantity: Quantity): void {
    this.assertReservedCovers(quantity);
    this.onHandValue = this.onHandValue.minus(quantity);
    this.reservedValue = this.reservedValue.minus(quantity);
  }

  /** 예약을 되돌린다. 보유량은 건드리지 않는다. */
  release(quantity: Quantity): void {
    this.assertReservedCovers(quantity);
    this.reservedValue = this.reservedValue.minus(quantity);
  }

  restock(quantity: Quantity): void {
    this.onHandValue = this.onHandValue.plus(quantity);
  }

  private assertReservedCovers(quantity: Quantity): void {
    if (quantity.isGreaterThan(this.reservedValue)) {
      throw new StockCounterMismatchError(this.skuId, this.reservedValue.value, quantity.value);
    }
  }
}
