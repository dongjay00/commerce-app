import type { OrderId } from '../../../../../shared/kernel/identifiers';
import type { Money } from '../../../../../shared/kernel/money';

export type PgResult =
  | { readonly outcome: 'APPROVED'; readonly pgTxId: string }
  | { readonly outcome: 'DECLINED'; readonly pgTxId: string; readonly reason: string };

/**
 * 외부 PG. 이 프로젝트에서 **유일하게 프로세스 밖을 향하는 포트**다.
 *
 * 거절이 예외가 아니라 결과인 이유: PG가 거절하는 것은 정상 동작이고, 예외로
 * 만들면 호출자가 정상 분기를 `catch`에서 처리하게 되어 진짜 장애(타임아웃, 5xx)와
 * 구분이 사라진다. **타임아웃과 네트워크 오류는 그대로 던진다** — 그것은 결과가
 * 아니라 오류이고, 사가는 그 경우 결제 여부를 알 수 없으므로 예약을 풀고 TTL에 맡긴다.
 */
export interface PgClient {
  charge(params: { orderId: OrderId; amount: Money }): Promise<PgResult>;
  /** 전액 환불만 한다(편차 4). 이미 환불된 거래에 다시 불려도 조용히 성공해야 한다. */
  refund(params: { pgTxId: string }): Promise<void>;
}

export const PG_CLIENT = Symbol('PgClient');
