import { OrderId, PaymentId } from '../../../../shared/kernel/identifiers';
import { Money } from '../../../../shared/kernel/money';
import type { Clock } from '../../../../shared/kernel/ports/clock';
import type { DomainEventPublisher } from '../../../../shared/kernel/ports/domain-event.publisher';
import type { IdGenerator } from '../../../../shared/kernel/ports/id-generator';
import type { TransactionManager } from '../../../../shared/kernel/ports/transaction-manager';
import { Payment } from '../../domain/payment';
import { PaymentAmountMismatchError, PaymentNotFoundError } from '../../domain/payment.errors';
import { PaymentAttempt } from '../../domain/payment-attempt';
import type {
  AuthorizePaymentCommand,
  AuthorizePaymentResult,
  AuthorizePaymentUseCase,
} from '../ports/in/authorize-payment.usecase';
import type { HandlePgCallbackCommand } from '../ports/in/handle-pg-callback.usecase';
import type { RefundPaymentCommand } from '../ports/in/refund-payment.usecase';
import type { PaymentRepository } from '../ports/out/payment.repository';
import type { PgClient } from '../ports/out/pg-client';

/**
 * 세 유스케이스를 한 서비스가 구현한다 — 셋 다 "찾거나 열고, 애그리거트 메서드를
 * 한 번 부르고, 저장하고, 이벤트를 발행한다"는 같은 골격이다.
 *
 * `AuthorizePaymentUseCase`만 `execute`로 구현하고 나머지 둘은 `refund`/`handleCallback`로
 * 노출한다 — 셋 다 `execute`일 수는 없다. 모듈이 얇은 객체 리터럴로 감싸 토큰에 바인딩한다.
 *
 * **PG 호출은 트랜잭션 밖에 있다.** 외부 HTTP 응답을 기다리며 DB 트랜잭션을 열어두면
 * 커넥션 풀이 말라죽는다(스펙 §6.1). 그래서 이 서비스는 트랜잭션을 두 번 연다:
 * 결제 행을 여는 트랜잭션, 그리고 결과를 반영하는 트랜잭션. 그 사이가 PG 호출이다.
 */
export class PaymentService implements AuthorizePaymentUseCase {
  constructor(
    private readonly payments: PaymentRepository,
    private readonly pg: PgClient,
    private readonly events: DomainEventPublisher,
    private readonly transactions: TransactionManager,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async execute(command: AuthorizePaymentCommand): Promise<AuthorizePaymentResult> {
    const orderId = OrderId.of(command.orderId);
    const amount = Money.fromDto({ amount: command.amount, currency: command.currency });
    const now = this.clock.now();

    // [트랜잭션 1] 결제 행을 연다. 이미 있으면 재사용한다 — payments.order_id가
    // 유니크라 새로 열면 P2002로 죽고, 재시도된 주문에서 실제로 그 경로가 생긴다.
    const payment = await this.transactions.run(async (tx) => {
      const existing = await this.payments.findByOrderId(orderId, tx);
      if (existing !== null) {
        // 스펙 §5.1의 불변식 "승인액 = 주문 금액". 금액이 다른데 조용히 재사용하면
        // 주문 금액과 다른 액수가 승인된 채 남고 정산에서야 드러난다.
        if (!existing.amount.equals(amount)) {
          throw new PaymentAmountMismatchError(
            command.orderId,
            amount.amount.toString(),
            existing.amount.amount.toString(),
          );
        }
        return existing;
      }
      const opened = Payment.open({
        id: PaymentId.of(this.ids.nextId()),
        orderId,
        amount,
        now,
      });
      await this.payments.save(opened, tx);
      return opened;
    });

    // [트랜잭션 없음] 외부 PG. 여기서 던지면 결제 행은 PENDING으로 남고,
    // 늦게 오는 웹훅이 정합시킬 대상이 된다.
    const result = await this.pg.charge({ orderId, amount });

    // [트랜잭션 2] 결과를 반영한다.
    const attempt = new PaymentAttempt(
      this.ids.nextId(),
      result.pgTxId,
      result.outcome === 'APPROVED' ? 'APPROVED' : 'DECLINED',
      result.outcome === 'APPROVED' ? null : result.reason,
      this.clock.now(),
    );

    return this.transactions.run(async (tx) => {
      if (result.outcome === 'APPROVED') {
        payment.authorize(attempt);
      } else {
        payment.decline(attempt);
      }
      await this.payments.save(payment, tx);
      await this.events.publish(payment.pullEvents(), tx);
      return result.outcome === 'APPROVED'
        ? { ok: true as const, paymentId: payment.id, pgTxId: result.pgTxId }
        : { ok: false as const, reason: result.reason };
    });
  }

  async refund(command: RefundPaymentCommand): Promise<boolean> {
    const orderId = OrderId.of(command.orderId);
    const now = this.clock.now();

    // 상태를 먼저 바꾼 뒤 PG를 부른다. 순서를 뒤집으면 PG는 환불했는데 상태가
    // AUTHORIZED로 남아 다음 호출이 또 환불한다. PG의 refund는 멱등하므로
    // (포트 주석) 반대 방향의 위험 — 상태만 바뀌고 PG를 못 부르는 것 — 은
    // 재시도로 복구된다.
    const outcome = await this.transactions.run(async (tx) => {
      const payment = await this.payments.findByOrderId(orderId, tx);
      if (payment === null) {
        throw new PaymentNotFoundError(command.orderId);
      }
      const refunded = payment.refund(now);
      if (!refunded) {
        return { refunded: false as const, pgTxId: null };
      }
      await this.payments.save(payment, tx);
      await this.events.publish(payment.pullEvents(), tx);
      const approved = payment.attempts.find((attempt) => attempt.approved);
      return { refunded: true as const, pgTxId: approved?.pgTxId ?? null };
    });

    if (outcome.refunded && outcome.pgTxId !== null) {
      await this.pg.refund({ pgTxId: outcome.pgTxId });
    }
    return outcome.refunded;
  }

  async handleCallback(command: HandlePgCallbackCommand): Promise<boolean> {
    const orderId = OrderId.of(command.orderId);
    const attempt = new PaymentAttempt(
      this.ids.nextId(),
      command.pgTxId,
      command.result,
      command.reason ?? null,
      this.clock.now(),
    );

    return this.transactions.run(async (tx) => {
      const payment = await this.payments.findByOrderId(orderId, tx);
      if (payment === null) {
        throw new PaymentNotFoundError(command.orderId);
      }
      const recorded = payment.recordCallback(attempt);
      if (recorded) {
        await this.payments.save(payment, tx);
      }
      return recorded;
    });
  }
}
