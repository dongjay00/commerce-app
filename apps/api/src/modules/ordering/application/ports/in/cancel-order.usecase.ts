import type { OrderStatus } from '../../../domain/order/order-status';

export interface CancelOrderCommand {
  readonly orderId: string;
  /** 본인 확인용. `Order.cancelBy`가 도메인에서 검사한다(스펙 §5.5). */
  readonly customerId: string;
}

export interface CancelOrderResult {
  /** 결제 전이면 `CANCELLED`, 결제 후면 `REFUND_PENDING`. */
  readonly status: OrderStatus;
}

export interface CancelOrderUseCase {
  execute(command: CancelOrderCommand): Promise<CancelOrderResult>;
}

export const CANCEL_ORDER_USECASE = Symbol('CancelOrderUseCase');
