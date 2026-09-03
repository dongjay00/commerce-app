export interface HandlePaymentRefundedCommand {
  readonly orderId: string;
}

export interface HandlePaymentRefundedUseCase {
  /** 전이가 실제로 일어났으면 `true`. 이미 REFUNDED면 `false`. */
  execute(command: HandlePaymentRefundedCommand): Promise<boolean>;
}

export const HANDLE_PAYMENT_REFUNDED_USECASE = Symbol('HandlePaymentRefundedUseCase');
