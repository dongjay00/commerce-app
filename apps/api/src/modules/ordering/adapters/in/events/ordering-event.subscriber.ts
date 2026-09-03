import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { requireString } from '../../../../../shared/infrastructure/messaging/event-payload';
import type { OutboxRecord } from '../../../../../shared/kernel/ports/event-transport';
import {
  HANDLE_PAYMENT_REFUNDED_USECASE,
  type HandlePaymentRefundedUseCase,
} from '../../../application/ports/in/handle-payment-refunded.usecase';
import {
  HANDLE_STOCK_RESERVATION_EXPIRED_USECASE,
  type HandleStockReservationExpiredUseCase,
} from '../../../application/ports/in/handle-stock-reservation-expired.usecase';

/**
 * Payment와 Inventory의 이벤트를 구독한다(스펙 §5.6). **역방향 의존은 전부 이벤트다**
 * (스펙 §4.1) — Ordering은 Core이고 아무도 그것을 직접 부르지 않는다.
 *
 * 이벤트 이름 문자열을 여기 적는 이유는 `InventoryEventSubscriber`의 주석과 같다.
 */
@Injectable()
export class OrderingEventSubscriber {
  private readonly logger = new Logger(OrderingEventSubscriber.name);

  constructor(
    @Inject(HANDLE_PAYMENT_REFUNDED_USECASE)
    private readonly onRefunded: HandlePaymentRefundedUseCase,
    @Inject(HANDLE_STOCK_RESERVATION_EXPIRED_USECASE)
    private readonly onExpired: HandleStockReservationExpiredUseCase,
  ) {}

  @OnEvent('payment.PaymentRefunded')
  async onPaymentRefunded(record: OutboxRecord): Promise<void> {
    const orderId = requireString(record.payload, 'orderId', record.eventType);
    this.log(record.eventType, orderId, await this.onRefunded.execute({ orderId }));
  }

  @OnEvent('inventory.StockReservationExpired')
  async onStockReservationExpired(record: OutboxRecord): Promise<void> {
    // 계획 3의 `stock.events.ts`가 payload에 orderId를 담았다.
    const orderId = requireString(record.payload, 'orderId', record.eventType);
    this.log(record.eventType, orderId, await this.onExpired.execute({ orderId }));
  }

  private log(eventType: string, orderId: string, changed: boolean): void {
    if (!changed) {
      this.logger.debug(`${eventType}(${orderId}): 이미 처리된 주문입니다.`);
      return;
    }
    this.logger.log(`${eventType}(${orderId}): 주문 상태를 갱신했습니다.`);
  }
}
