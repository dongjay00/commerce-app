import { OrderId, PaymentId } from '../../../../../shared/kernel/identifiers';
import { type Currency, Money } from '../../../../../shared/kernel/money';
import { Payment } from '../../../domain/payment';
import { type AttemptResult, PaymentAttempt } from '../../../domain/payment-attempt';

export interface PaymentAttemptRow {
  id: string;
  pgTxId: string;
  result: string;
  reason: string | null;
  attemptedAt: Date;
}

export interface PaymentRow {
  id: string;
  orderId: string;
  status: string;
  authorizedAmount: bigint;
  currency: string;
  attempts: PaymentAttemptRow[];
}

/**
 * 저장된 행 → 애그리거트.
 *
 * `PaymentId.fromPersistence`/`OrderId.fromPersistence`를 쓴다 — `.of`는 깨진 행에
 * 400을 내고 클라이언트에게 "당신의 요청이 잘못됐다"고 거짓말한다(계획 1의 M7).
 * 같은 이유로 알 수 없는 `status`는 `Payment.rehydrate`가 `CorruptedPaymentError`
 * (평문 `Error`, 500)로 잡는다.
 *
 * `result`와 `currency` 컬럼도 마찬가지다. 열거값이 아닌 값이 들어 있으면 그건
 * 우리 데이터가 깨진 것이므로 500이다.
 */
export function toPaymentDomain(row: PaymentRow): Payment {
  return Payment.rehydrate({
    id: PaymentId.fromPersistence(row.id),
    orderId: OrderId.fromPersistence(row.orderId),
    amount: Money.of(row.authorizedAmount, asCurrency(row.currency, row.id)),
    status: row.status,
    attempts: row.attempts.map((attempt) => toAttemptDomain(attempt, row.id)),
  });
}

function toAttemptDomain(row: PaymentAttemptRow, paymentId: string): PaymentAttempt {
  if (row.result !== 'APPROVED' && row.result !== 'DECLINED') {
    throw new Error(`저장된 결제 시도 결과를 해석할 수 없습니다 (${paymentId}): "${row.result}"`);
  }
  return new PaymentAttempt(
    row.id,
    row.pgTxId,
    row.result as AttemptResult,
    row.reason,
    row.attemptedAt,
  );
}

function asCurrency(value: string, paymentId: string): Currency {
  if (value !== 'KRW' && value !== 'USD') {
    throw new Error(`저장된 통화를 해석할 수 없습니다 (${paymentId}): "${value}"`);
  }
  return value;
}
