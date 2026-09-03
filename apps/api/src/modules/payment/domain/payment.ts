import { AggregateRoot } from '../../../shared/kernel/aggregate-root';
import type { OrderId, PaymentId } from '../../../shared/kernel/identifiers';
import type { Money } from '../../../shared/kernel/money';
import { CorruptedPaymentError, PaymentConflictError } from './payment.errors';
import { paymentRefunded } from './payment.events';
import type { PaymentAttempt } from './payment-attempt';

export type PaymentStatus = 'PENDING' | 'AUTHORIZED' | 'DECLINED' | 'REFUNDED';

const KNOWN_STATUSES: readonly string[] = ['PENDING', 'AUTHORIZED', 'DECLINED', 'REFUNDED'];

/**
 * 결제 애그리거트. 상태 머신 하나와 시도 이력이 전부다 — 스펙 §4가 payment를
 * "포트 뒤에 숨김" Supporting 컨텍스트로 분류했고, 여기 도메인 로직을 더 넣을수록
 * 진짜 PG로 교체할 때 버릴 코드가 는다.
 *
 * 전이 메서드는 **성공하면 `true`, 이미 그 상태면 `false`, 되돌릴 수 없으면 던진다.**
 * `OrderCancelled`가 outbox를 거쳐 at-least-once로 배달되므로(스펙 §6.3) `refund`가
 * 두 번 불릴 수 있고, 두 번째가 환불을 한 번 더 실행하면 돈이 두 번 나간다.
 */
export class Payment extends AggregateRoot {
  private constructor(
    readonly id: PaymentId,
    readonly orderId: OrderId,
    readonly amount: Money,
    private statusValue: PaymentStatus,
    private readonly attemptList: PaymentAttempt[],
  ) {
    super();
  }

  /**
   * `now`는 지금 쓰이지 않지만 시그니처에 남긴다 — 태스크 5의 매퍼가 `created_at`을
   * 채우고 그 값의 출처는 `Clock`이어야 한다. 유스케이스가 `new Date()`를 부르기
   * 시작하면 TTL·만료 테스트가 통째로 불가능해진다(스펙 §7.3).
   */
  static open(params: { id: PaymentId; orderId: OrderId; amount: Money; now: Date }): Payment {
    // 0원 결제는 결제가 아니다. 여기까지 왔다면 주문 총계 계산이 깨진 것이므로
    // 평문 Error(500)다 — 사용자가 고칠 수 있는 것이 없다.
    if (params.amount.amount <= 0n) {
      throw new Error(`결제 금액은 0보다 커야 합니다: ${params.amount.amount}`);
    }
    return new Payment(params.id, params.orderId, params.amount, 'PENDING', []);
  }

  static rehydrate(params: {
    id: PaymentId;
    orderId: OrderId;
    amount: Money;
    status: string;
    attempts: PaymentAttempt[];
  }): Payment {
    if (!KNOWN_STATUSES.includes(params.status)) {
      throw new CorruptedPaymentError(params.id, params.status);
    }
    return new Payment(params.id, params.orderId, params.amount, params.status as PaymentStatus, [
      ...params.attempts,
    ]);
  }

  get status(): PaymentStatus {
    return this.statusValue;
  }

  /** 복사본을 돌려준다 — 내부 배열이 새면 pgTxId 유일성 검사가 우회된다. */
  get attempts(): readonly PaymentAttempt[] {
    return [...this.attemptList];
  }

  authorize(attempt: PaymentAttempt): boolean {
    if (this.statusValue === 'AUTHORIZED') {
      return false;
    }
    this.assertFrom('PENDING', 'AUTHORIZED');
    this.attemptList.push(attempt);
    this.statusValue = 'AUTHORIZED';
    return true;
  }

  decline(attempt: PaymentAttempt): boolean {
    if (this.statusValue === 'DECLINED') {
      return false;
    }
    this.assertFrom('PENDING', 'DECLINED');
    this.attemptList.push(attempt);
    this.statusValue = 'DECLINED';
    return true;
  }

  refund(now: Date): boolean {
    if (this.statusValue === 'REFUNDED') {
      return false;
    }
    this.assertFrom('AUTHORIZED', 'REFUNDED');
    this.statusValue = 'REFUNDED';
    this.raise(paymentRefunded(this, now));
    return true;
  }

  /**
   * PG 웹훅이 도착했다. **주문을 움직이지 않는다** — 편차 3.
   *
   * 같은 `pgTxId`가 이미 있으면 아무것도 하지 않고 `false`. 처음 보는 것이면
   * 시도를 남기고, **`PENDING`일 때만** 상태를 정합시킨다. 이미 결말이 난 결제를
   * 늦게 온 콜백이 되돌리면 환불된 돈이 되살아난다.
   */
  recordCallback(attempt: PaymentAttempt): boolean {
    if (this.attemptList.some((existing) => existing.pgTxId === attempt.pgTxId)) {
      return false;
    }
    this.attemptList.push(attempt);
    if (this.statusValue === 'PENDING') {
      this.statusValue = attempt.approved ? 'AUTHORIZED' : 'DECLINED';
    }
    return true;
  }

  private assertFrom(expected: PaymentStatus, to: PaymentStatus): void {
    if (this.statusValue !== expected) {
      throw new PaymentConflictError(this.id, this.statusValue, to);
    }
  }
}
