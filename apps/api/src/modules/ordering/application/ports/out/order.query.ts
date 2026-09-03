import type { CustomerId, OrderId } from '../../../../../shared/kernel/identifiers';

export interface MoneyView {
  readonly amount: string;
  readonly currency: string;
}

export interface ShippingAddressView {
  readonly recipient: string;
  readonly phone: string;
  readonly zip: string;
  readonly line1: string;
  readonly line2: string | null;
}

export interface OrderLineView {
  readonly skuId: string;
  readonly nameSnapshot: string;
  readonly unitPrice: MoneyView;
  readonly quantity: number;
  readonly subtotal: MoneyView;
}

/**
 * 읽기 전용 모델. 애그리거트를 재구성하지 않고 Prisma가 직접 projection한다(스펙 §7.2).
 *
 * `@commerce/contracts`의 DTO를 쓰지 않는 이유는 애플리케이션 계층이 와이어 계약에
 * 묶이지 않기 위해서다 — 컨트롤러가 옮긴다.
 *
 * `customerId`가 뷰에 있는 것이 **인가의 근거다**. `OrderQuery`는 DTO를 돌려주므로
 * `Order.assertOwnedBy`를 부를 수 없고, 서비스가 이 값을 비교한다. 컨트롤러가 DTO로
 * 옮길 때 이 필드를 떨어뜨린다 — 와이어에는 나가지 않는다.
 */
export interface OrderView {
  readonly id: string;
  readonly customerId: string;
  readonly status: string;
  readonly total: MoneyView;
  readonly placedAt: string;
  readonly shippingAddress: ShippingAddressView;
  readonly lines: OrderLineView[];
}

/** 목록용. 라인 전체를 실으면 20건 조회에 200줄이 딸려온다 — 개수만 준다. */
export interface OrderSummaryView {
  readonly id: string;
  readonly status: string;
  readonly total: MoneyView;
  readonly placedAt: string;
  readonly lineCount: number;
}

export interface OrderQuery {
  findById(orderId: OrderId): Promise<OrderView | null>;
  /** 최신 주문부터. `orders_customer_placed_at_idx`가 이 정렬을 지원한다. */
  listByCustomer(
    customerId: CustomerId,
    params: { limit: number; offset: number },
  ): Promise<OrderSummaryView[]>;
}

export const ORDER_QUERY = Symbol('OrderQuery');
