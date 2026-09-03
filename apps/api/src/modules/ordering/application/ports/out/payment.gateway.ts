import type { OrderId } from '../../../../../shared/kernel/identifiers';
import type { Money } from '../../../../../shared/kernel/money';

export type AuthorizeOutcome =
  | { readonly ok: true; readonly paymentId: string; readonly pgTxId: string }
  | { readonly ok: false; readonly reason: string };

/**
 * Payment로 나가는 ACL. **PG를 직접 부르지 않는다** — payment 모듈을 부른다(스펙 §7.4).
 *
 * 거절이 `ok: false`인 것이 사가의 갈림길이다(스펙 §6.2의 4a/4b). PG 타임아웃 같은
 * 진짜 오류는 그대로 던져 올라오고, 그때 사가는 결제 여부를 알 수 없으므로 예약을
 * 풀고 TTL에 맡긴다.
 */
export interface PaymentGateway {
  authorize(params: { orderId: OrderId; amount: Money }): Promise<AuthorizeOutcome>;
}

export const PAYMENT_GATEWAY = Symbol('PaymentGateway');
