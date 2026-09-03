import type { OrderId, PaymentId } from '../../../../../shared/kernel/identifiers';
import type { TransactionContext } from '../../../../../shared/kernel/ports/transaction-manager';
import type { Payment } from '../../../domain/payment';

export interface PaymentRepository {
  findById(id: PaymentId, tx?: TransactionContext): Promise<Payment | null>;
  /** 주문당 결제는 하나다 — `payments.order_id`가 유니크다. */
  findByOrderId(orderId: OrderId, tx?: TransactionContext): Promise<Payment | null>;
  save(payment: Payment, tx?: TransactionContext): Promise<void>;
}

export const PAYMENT_REPOSITORY = Symbol('PaymentRepository');
