import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  requireBoolean,
  requireString,
} from '../../../../../shared/infrastructure/messaging/event-payload';
import type { OutboxRecord } from '../../../../../shared/kernel/ports/event-transport';
import {
  REFUND_PAYMENT_USECASE,
  type RefundPaymentUseCase,
} from '../../../application/ports/in/refund-payment.usecase';

/**
 * `OrderCancelled`를 구독해 환불한다(스펙 §5.6).
 *
 * **`wasPaid`가 `true`일 때만 환불한다.** 결제 전 취소는 돈이 오간 적이 없고,
 * 환불을 시도하면 `PaymentNotFoundError`가 나 릴레이가 영원히 재시도한다.
 *
 * 같은 이벤트를 Inventory도 구독한다 — `EventEmitter2.emitAsync`는 모든 리스너를
 * 부르고 하나라도 거부하면 전체가 거부되어 **이미 성공한 구독자도 다시 불린다.**
 * 그래서 양쪽 다 멱등해야 하고, `Payment.refund()`가 `false`를 돌려주는 것이
 * 그 요구를 갚는다.
 */
@Injectable()
export class PaymentEventSubscriber {
  private readonly logger = new Logger(PaymentEventSubscriber.name);

  constructor(
    @Inject(REFUND_PAYMENT_USECASE) private readonly refundPayment: RefundPaymentUseCase,
  ) {}

  @OnEvent('ordering.OrderCancelled', { suppressErrors: false })
  async onOrderCancelled(record: OutboxRecord): Promise<void> {
    const orderId = requireString(record.payload, 'orderId', record.eventType);
    const wasPaid = requireBoolean(record.payload, 'wasPaid', record.eventType);
    if (!wasPaid) {
      this.logger.debug(`${record.eventType}(${orderId}): 결제 전 취소라 환불하지 않습니다.`);
      return;
    }
    const refunded = await this.refundPayment.execute({ orderId });
    if (refunded) {
      this.logger.log(`${record.eventType}(${orderId}): 환불했습니다.`);
      return;
    }
    this.logger.debug(`${record.eventType}(${orderId}): 이미 환불된 결제입니다.`);
  }
}
