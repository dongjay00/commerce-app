import type { OrderId } from '../../../shared/kernel/identifiers';
import type { Money } from '../../../shared/kernel/money';
import type { AuthorizeOutcome, PaymentGateway } from '../application/ports/out/payment.gateway';

export class FakePaymentGateway implements PaymentGateway {
  readonly calls: Array<{ orderId: string; amount: string }> = [];

  private outcome: AuthorizeOutcome = { ok: true, paymentId: 'payment-1', pgTxId: 'pgtx-1' };
  private failure: Error | null = null;

  approve(): this {
    this.outcome = { ok: true, paymentId: 'payment-1', pgTxId: 'pgtx-1' };
    this.failure = null;
    return this;
  }

  decline(reason = '카드 한도를 초과했습니다.'): this {
    this.outcome = { ok: false, reason };
    this.failure = null;
    return this;
  }

  /** PG 타임아웃처럼 결과가 아니라 오류인 경우. 사가는 결제 여부를 알 수 없다. */
  throwWith(error: Error): this {
    this.failure = error;
    return this;
  }

  async authorize(params: { orderId: OrderId; amount: Money }): Promise<AuthorizeOutcome> {
    this.calls.push({ orderId: params.orderId, amount: params.amount.amount.toString() });
    if (this.failure !== null) {
      throw this.failure;
    }
    return this.outcome;
  }
}
