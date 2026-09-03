export type AttemptResult = 'APPROVED' | 'DECLINED';

/**
 * PG 호출 한 번의 기록. **VO가 아니라 엔티티다** — `pgTxId`로 식별되고,
 * 웹훅 멱등성이 그 식별자의 유일성 위에 서 있다(스펙 §10.8).
 *
 * 불변이다. 시도는 일어난 뒤 바뀌지 않는다.
 */
export class PaymentAttempt {
  constructor(
    readonly id: string,
    readonly pgTxId: string,
    readonly result: AttemptResult,
    readonly reason: string | null,
    readonly attemptedAt: Date,
  ) {}

  get approved(): boolean {
    return this.result === 'APPROVED';
  }
}
