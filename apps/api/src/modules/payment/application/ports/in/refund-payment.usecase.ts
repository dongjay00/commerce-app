export interface RefundPaymentCommand {
  readonly orderId: string;
}

export interface RefundPaymentUseCase {
  /** 실제로 환불이 일어났으면 `true`. 이미 환불된 결제면 `false`. */
  execute(command: RefundPaymentCommand): Promise<boolean>;
}

export const REFUND_PAYMENT_USECASE = Symbol('RefundPaymentUseCase');
