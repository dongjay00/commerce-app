import type { OrderStatus } from '../../../domain/order/order-status';

export interface PlaceOrderCommand {
  readonly customerId: string;
  /** 고객이 주소록에서 고른 배송지. 기본값에 의존하지 않는다 — 포트 주석 참조. */
  readonly addressId: string;
}

export interface PlaceOrderResult {
  readonly orderId: string;
  /**
   * `PAID` 또는 `PAYMENT_FAILED`.
   *
   * **`PAYMENT_FAILED`가 예외가 아니라 결과인 이유**: 결제 거절은 주문이 정상적으로
   * 끝난 상태다. 주문 번호가 있고 사용자는 그 화면에서 다시 시도할 수 있다. 예외로
   * 만들면 주문 번호를 응답에 실을 수 없다.
   *
   * 예약이나 조립 단계에서 실패하면 예외가 나간다 — 그때는 주문이 없다.
   */
  readonly status: OrderStatus;
}

export interface PlaceOrderUseCase {
  execute(command: PlaceOrderCommand): Promise<PlaceOrderResult>;
}

export const PLACE_ORDER_USECASE = Symbol('PlaceOrderUseCase');
