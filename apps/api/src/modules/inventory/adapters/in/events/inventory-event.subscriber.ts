import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  requireBoolean,
  requireString,
} from '../../../../../shared/infrastructure/messaging/event-payload';
import type { OutboxRecord } from '../../../../../shared/kernel/ports/event-transport';
import {
  CONFIRM_RESERVATIONS_FOR_ORDER_USECASE,
  type ConfirmReservationsForOrderUseCase,
} from '../../../application/ports/in/confirm-reservations-for-order.usecase';
import {
  RELEASE_RESERVATIONS_FOR_ORDER_USECASE,
  type ReleaseReservationsForOrderUseCase,
} from '../../../application/ports/in/release-reservations-for-order.usecase';
import {
  RESTORE_RESERVATIONS_FOR_ORDER_USECASE,
  type RestoreReservationsForOrderUseCase,
} from '../../../application/ports/in/restore-reservations-for-order.usecase';

/**
 * Ordering의 이벤트를 구독해 예약을 확정·해제·복원한다(스펙 §5.6).
 *
 * **이벤트 이름 문자열을 여기 적는다.** ordering의 상수를 import하면
 * `no-cross-module-internals`에 걸리고, `ordering/index.ts`가 내보내게 하면 Supporting이
 * Core의 공개 API에 묶인다 — 역방향 의존이 이름 하나라도 생기면 순환의 여지가
 * 생긴다(스펙 §4.1). 문자열이 어긋나면 **구독자가 조용히 안 불린다**는 것이 이
 * 선택의 대가이고, 태스크 20의 사가 E2E가 그것을 잡는 유일한 장치다.
 *
 * 던지면 릴레이가 재시도한다. 이미 처리된 이벤트(처리 건수 0)에는 **던지지 않는다** —
 * 던지면 그 이벤트가 데드레터에 도달할 때까지 outbox의 head-of-line을 차지한다.
 */
@Injectable()
export class InventoryEventSubscriber {
  private readonly logger = new Logger(InventoryEventSubscriber.name);

  constructor(
    @Inject(CONFIRM_RESERVATIONS_FOR_ORDER_USECASE)
    private readonly confirmForOrder: ConfirmReservationsForOrderUseCase,
    @Inject(RELEASE_RESERVATIONS_FOR_ORDER_USECASE)
    private readonly releaseForOrder: ReleaseReservationsForOrderUseCase,
    @Inject(RESTORE_RESERVATIONS_FOR_ORDER_USECASE)
    private readonly restoreForOrder: RestoreReservationsForOrderUseCase,
  ) {}

  @OnEvent('ordering.OrderPaid')
  async onOrderPaid(record: OutboxRecord): Promise<void> {
    const orderId = requireString(record.payload, 'orderId', record.eventType);
    this.log(record.eventType, orderId, await this.confirmForOrder.execute({ orderId }));
  }

  @OnEvent('ordering.OrderPaymentFailed')
  async onOrderPaymentFailed(record: OutboxRecord): Promise<void> {
    const orderId = requireString(record.payload, 'orderId', record.eventType);
    this.log(record.eventType, orderId, await this.releaseForOrder.execute({ orderId }));
  }

  @OnEvent('ordering.OrderCancelled')
  async onOrderCancelled(record: OutboxRecord): Promise<void> {
    const orderId = requireString(record.payload, 'orderId', record.eventType);
    // 결제 전 취소면 예약은 아직 PENDING이라 해제, 결제 후면 CONFIRMED라 복원이다.
    // 이 값이 없으면 Inventory가 예약 상태를 보고 추측해야 하고, 추측은 경합에서 틀린다.
    const wasPaid = requireBoolean(record.payload, 'wasPaid', record.eventType);
    const processed = wasPaid
      ? await this.restoreForOrder.execute({ orderId })
      : await this.releaseForOrder.execute({ orderId });
    this.log(record.eventType, orderId, processed);
  }

  private log(eventType: string, orderId: string, processed: number): void {
    if (processed === 0) {
      // 중복 배달이거나 이미 처리된 주문이다. 정상이지만 빈도가 높으면 릴레이를 봐야 한다.
      this.logger.debug(`${eventType}(${orderId}): 처리할 예약이 없습니다.`);
      return;
    }
    this.logger.log(`${eventType}(${orderId}): 예약 ${processed}건을 처리했습니다.`);
  }
}
