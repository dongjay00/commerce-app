import type { OrderId, PaymentId } from '../../../shared/kernel/identifiers';
import type { TransactionContext } from '../../../shared/kernel/ports/transaction-manager';
import type { PaymentRepository } from '../application/ports/out/payment.repository';
import { Payment } from '../domain/payment';
import { PaymentAttempt } from '../domain/payment-attempt';

/**
 * 단위 테스트용 PaymentRepository.
 *
 * **저장할 때 복사한다.** 저장본을 그대로 넘기면 호출자가 나중에 그 객체를 바꿨을 때
 * 저장소가 조용히 따라 바뀌어, 진짜 DB에서는 절대 일어나지 않는 일이 통과한다.
 * 계획 3의 in-memory 재고 리포지토리가 정확히 이 버그로 계약 스위트를 통과시켰다.
 */
export class InMemoryPaymentRepository implements PaymentRepository {
  private readonly byId = new Map<string, Payment>();

  async findById(id: PaymentId, _tx?: TransactionContext): Promise<Payment | null> {
    const found = this.byId.get(id);
    return found === undefined ? null : InMemoryPaymentRepository.copy(found);
  }

  async findByOrderId(orderId: OrderId, _tx?: TransactionContext): Promise<Payment | null> {
    for (const payment of this.byId.values()) {
      if (payment.orderId === orderId) {
        return InMemoryPaymentRepository.copy(payment);
      }
    }
    return null;
  }

  async save(payment: Payment, _tx?: TransactionContext): Promise<void> {
    this.byId.set(payment.id, InMemoryPaymentRepository.copy(payment));
  }

  private static copy(payment: Payment): Payment {
    return Payment.rehydrate({
      id: payment.id,
      orderId: payment.orderId,
      amount: payment.amount,
      status: payment.status,
      attempts: payment.attempts.map(
        (a) => new PaymentAttempt(a.id, a.pgTxId, a.result, a.reason, a.attemptedAt),
      ),
    });
  }
}
