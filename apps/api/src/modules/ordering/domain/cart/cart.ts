import type { CartId, CustomerId, SkuId } from '../../../../shared/kernel/identifiers';
import type { Quantity } from '../../../../shared/kernel/quantity';
import { CartLineLimitExceededError, CartLineNotFoundError } from './cart.errors';
import { CartLine } from './cart-line';

/** 상한의 근거는 `CartLineLimitExceededError`의 주석에 있다. */
const MAX_LINES = 20;

/**
 * 장바구니 애그리거트.
 *
 * **`AggregateRoot`를 상속하지 않는다.** 장바구니 변경은 이벤트를 발행하지 않는다 —
 * 스펙 §5.6의 이벤트 목록에 장바구니가 없고, 구독자 없는 이벤트는 outbox에 쌓이는
 * 쓰레기다.
 *
 * **가격이 없다.** 장바구니는 "무엇을 몇 개"만 들고 가격은 주문 시점에 Catalog에서
 * 스냅샷으로 온다(스펙 §5.3). 장바구니가 가격을 들면 상품 가격이 바뀌었을 때 낡은
 * 값을 보여주게 되고, 그 값을 신뢰해 주문하면 결제 금액이 달라진다.
 */
export class Cart {
  private constructor(
    readonly id: CartId,
    readonly customerId: CustomerId,
    private readonly lineList: CartLine[],
  ) {}

  static create(params: { id: CartId; customerId: CustomerId }): Cart {
    return new Cart(params.id, params.customerId, []);
  }

  static rehydrate(params: { id: CartId; customerId: CustomerId; lines: CartLine[] }): Cart {
    return new Cart(params.id, params.customerId, [...params.lines]);
  }

  /** 복사본을 돌려준다 — 내부 배열이 새면 중복 없음·상한 불변식이 우회된다. */
  get lines(): readonly CartLine[] {
    return [...this.lineList];
  }

  get isEmpty(): boolean {
    return this.lineList.length === 0;
  }

  addItem(skuId: SkuId, quantity: Quantity): void {
    const index = this.indexOf(skuId);
    if (index >= 0) {
      // 같은 SKU는 줄을 늘리지 않고 수량을 합친다 — 스펙 §5.1의 "같은 SKU 중복 없음".
      // 상한 검사보다 먼저 와야 한다. 이미 담긴 것을 더 담는 것은 줄을 늘리지 않는다.
      const existing = this.lineList[index] as CartLine;
      this.lineList[index] = existing.withQuantity(existing.quantity.plus(quantity));
      return;
    }
    if (this.lineList.length >= MAX_LINES) {
      throw new CartLineLimitExceededError(MAX_LINES);
    }
    this.lineList.push(new CartLine(skuId, quantity));
  }

  changeQuantity(skuId: SkuId, quantity: Quantity): void {
    const index = this.requireIndexOf(skuId);
    this.lineList[index] = (this.lineList[index] as CartLine).withQuantity(quantity);
  }

  removeItem(skuId: SkuId): void {
    this.lineList.splice(this.requireIndexOf(skuId), 1);
  }

  /** 주문이 만들어지면 비운다. 주문 실패 시에는 부르지 않는다 — 태스크 12. */
  clear(): void {
    this.lineList.length = 0;
  }

  private indexOf(skuId: SkuId): number {
    return this.lineList.findIndex((line) => line.skuId === skuId);
  }

  private requireIndexOf(skuId: SkuId): number {
    const index = this.indexOf(skuId);
    if (index < 0) {
      throw new CartLineNotFoundError(skuId);
    }
    return index;
  }
}
