export interface AuthorizePaymentCommand {
  readonly orderId: string;
  readonly amount: string;
  readonly currency: 'KRW' | 'USD';
}

/**
 * 거절이 `ok: false`로 오는 것이 사가의 갈림길이다(스펙 §6.2의 4a/4b).
 * 예외는 진짜 오류일 때만 나온다.
 */
export type AuthorizePaymentResult =
  | { readonly ok: true; readonly paymentId: string; readonly pgTxId: string }
  | { readonly ok: false; readonly reason: string };

export interface AuthorizePaymentUseCase {
  execute(command: AuthorizePaymentCommand): Promise<AuthorizePaymentResult>;
}

export const AUTHORIZE_PAYMENT_USECASE = Symbol('AuthorizePaymentUseCase');
