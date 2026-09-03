import { AggregateRoot } from '../../../../shared/kernel/aggregate-root';
import type { CustomerId, OrderId } from '../../../../shared/kernel/identifiers';
import { Money } from '../../../../shared/kernel/money';
import {
  CorruptedOrderError,
  EmptyOrderError,
  MixedCurrencyOrderError,
  OrderConflictError,
  OrderNotOwnedError,
} from './order.errors';
import { orderCancelled, orderPaid, orderPaymentFailed, orderPlaced } from './order.events';
import type { OrderLine } from './order-line';
import { isOrderStatus, type OrderStatus } from './order-status';
import type { ShippingAddress } from './shipping-address';

/**
 * 주문 애그리거트. **상태 머신이 사가 상태를 겸한다** — 스펙 §6.2가 별도 사가
 * 엔티티를 두지 않기로 했고, `Order` 자체가 이미 상태 머신인데 그 위에 또 하나를
 * 얹는 것은 이 규모에 과하다.
 *
 * 전이 메서드는 **성공하면 `true`, 이미 그 상태면 `false`, 되돌릴 수 없으면 던진다.**
 * 이벤트가 outbox를 거쳐 at-least-once로 배달되므로(스펙 §6.3) 같은 전이가 두 번
 * 요청될 수 있고, 두 번째가 이벤트를 다시 발행하면 환불이 두 번 나간다.
 */
export class Order extends AggregateRoot {
  private constructor(
    readonly id: OrderId,
    readonly customerId: CustomerId,
    private statusValue: OrderStatus,
    private readonly lineList: OrderLine[],
    readonly shippingAddress: ShippingAddress,
    readonly total: Money,
    readonly placedAt: Date,
  ) {
    super();
  }

  static place(params: {
    id: OrderId;
    customerId: CustomerId;
    lines: OrderLine[];
    shippingAddress: ShippingAddress;
    now: Date;
  }): Order {
    if (params.lines.length === 0) {
      throw new EmptyOrderError();
    }
    // 통화 검사가 Money.sum보다 먼저 온다. 순서가 반대면 CurrencyMismatchError
    // (평문 Error, 500)가 튀어나와 편차 2가 막으려던 회귀가 그대로 살아난다.
    Order.assertSingleCurrency(params.lines);
    Order.assertNoDuplicateSku(params.id, params.lines);

    const total = Money.sum(params.lines.map((line) => line.subtotal));
    const order = new Order(
      params.id,
      params.customerId,
      'PENDING_PAYMENT',
      [...params.lines],
      params.shippingAddress,
      total,
      params.now,
    );
    order.raise(orderPlaced(order, params.now));
    return order;
  }

  static rehydrate(params: {
    id: OrderId;
    customerId: CustomerId;
    status: string;
    lines: OrderLine[];
    shippingAddress: ShippingAddress;
    total: Money;
    placedAt: Date;
  }): Order {
    if (!isOrderStatus(params.status)) {
      throw new CorruptedOrderError(params.id, `알 수 없는 상태 "${params.status}"`);
    }
    if (params.lines.length === 0) {
      throw new CorruptedOrderError(params.id, '라인이 없습니다');
    }
    const computed = Money.sum(
      params.lines.map((line) => line.subtotal),
      params.total.currency,
    );
    if (!computed.equals(params.total)) {
      // 스펙 §5.1의 불변식 "합계 = Σ(단가×수량)". 어긋난 채 읽어들이면 그 주문은
      // 영원히 틀린 금액을 보여준다.
      throw new CorruptedOrderError(
        params.id,
        `총액이 라인 합과 다릅니다: 저장 ${params.total.amount}, 계산 ${computed.amount}`,
      );
    }
    return new Order(
      params.id,
      params.customerId,
      params.status,
      [...params.lines],
      params.shippingAddress,
      params.total,
      params.placedAt,
    );
  }

  get status(): OrderStatus {
    return this.statusValue;
  }

  /** 복사본을 돌려준다 — 내부 배열이 새면 총액 불변식이 우회된다. */
  get lines(): readonly OrderLine[] {
    return [...this.lineList];
  }

  markPaid(now: Date): boolean {
    if (this.statusValue === 'PAID') {
      return false;
    }
    this.assertFrom('PENDING_PAYMENT', 'PAID');
    this.statusValue = 'PAID';
    this.raise(orderPaid(this, now));
    return true;
  }

  failPayment(reason: string, now: Date): boolean {
    if (this.statusValue === 'PAYMENT_FAILED') {
      return false;
    }
    this.assertFrom('PENDING_PAYMENT', 'PAYMENT_FAILED');
    this.statusValue = 'PAYMENT_FAILED';
    this.raise(orderPaymentFailed(this, reason, now));
    return true;
  }

  /**
   * **도메인 인가가 여기 있다** — 스펙 §5.5. 가드로 처리하면 HTTP가 아닌 경로
   * (배치, 이벤트 핸들러, 관리자 CLI)로 들어올 때 규칙이 통째로 사라진다.
   *
   * 소유자 검사가 상태 검사보다 **먼저** 온다. 순서가 반대면 남의 주문의 상태를
   * 응답으로 유추할 수 있다.
   */
  cancelBy(customerId: CustomerId, now: Date): boolean {
    this.assertOwnedBy(customerId);

    if (this.statusValue === 'CANCELLED' || this.statusValue === 'REFUND_PENDING') {
      return false;
    }
    if (this.statusValue === 'PENDING_PAYMENT') {
      this.statusValue = 'CANCELLED';
      this.raise(orderCancelled(this, false, now));
      return true;
    }
    if (this.statusValue === 'PAID') {
      // 편차 1: 환불이 끝날 때까지 REFUND_PENDING으로 둔다.
      this.statusValue = 'REFUND_PENDING';
      this.raise(orderCancelled(this, true, now));
      return true;
    }
    throw new OrderConflictError(this.id, this.statusValue, 'CANCELLED');
  }

  /**
   * `PaymentRefunded` 구독자가 부른다(태스크 13).
   *
   * 이벤트를 발행하지 않는다 — `OrderRefunded`를 구독하는 곳이 없고, 구독자 없는
   * 이벤트는 outbox에 쌓이는 쓰레기다. `now`는 시그니처를 다른 전이 메서드와 맞추기
   * 위한 것이고, 환불 시각을 기록하게 되면 여기서 쓴다.
   */
  markRefunded(now: Date): boolean {
    void now;
    if (this.statusValue === 'REFUNDED') {
      return false;
    }
    this.assertFrom('REFUND_PENDING', 'REFUNDED');
    this.statusValue = 'REFUNDED';
    return true;
  }

  assertOwnedBy(customerId: CustomerId): void {
    if (this.customerId !== customerId) {
      throw new OrderNotOwnedError(this.id);
    }
  }

  private assertFrom(expected: OrderStatus, to: OrderStatus): void {
    if (this.statusValue !== expected) {
      throw new OrderConflictError(this.id, this.statusValue, to);
    }
  }

  private static assertSingleCurrency(lines: readonly OrderLine[]): void {
    const currencies = [...new Set(lines.map((line) => line.unitPrice.currency))];
    if (currencies.length > 1) {
      throw new MixedCurrencyOrderError(currencies);
    }
  }

  private static assertNoDuplicateSku(id: OrderId, lines: readonly OrderLine[]): void {
    // 장바구니가 중복을 막지만(태스크 7) 주문 조립이 그것을 신뢰하지 않는다.
    // 중복이 통과하면 (order_id, sku_id) 기본키에 걸려 저장이 500으로 죽는데,
    // 그때는 원인이 어디였는지 알 수 없다.
    if (new Set(lines.map((line) => line.skuId)).size !== lines.length) {
      throw new CorruptedOrderError(id, '같은 SKU가 두 줄에 있습니다');
    }
  }
}
