import { Inject, Injectable } from '@nestjs/common';
// biome-ignore lint/style/useImportType: Nest DI가 design:paramtypes 런타임 값을 요구한다.
import { SchedulerRegistry } from '@nestjs/schedule';
import { IntervalScheduler } from '../../../../../shared/infrastructure/scheduler/interval-scheduler';
import type { SchedulerConfig } from '../../../../../shared/infrastructure/scheduler/scheduler.config';
import {
  EXPIRE_RESERVATIONS_USECASE,
  type ExpireReservationsUseCase,
} from '../../../application/ports/in/expire-reservations.usecase';

/**
 * TTL 자가치유의 시계다 (스펙 §6.2 step 5, "설계의 요체").
 *
 * 보상 트랜잭션이 실패하거나 유실돼도 이 스캔이 예약을 회수한다 — 사가의 마지막
 * 그물이다. 만료 건수를 로그에 남기는 이유: 운영에서 "보상 트랜잭션이 얼마나
 * 실패하고 있는가"를 보는 유일한 창이다. 이 숫자가 평소보다 크면 릴리스 경로에
 * 문제가 있다는 신호다.
 */
@Injectable()
export class ReservationExpiryScheduler extends IntervalScheduler {
  constructor(
    registry: SchedulerRegistry,
    config: SchedulerConfig,
    @Inject(EXPIRE_RESERVATIONS_USECASE)
    private readonly expireReservations: ExpireReservationsUseCase,
  ) {
    super(registry, 'reservation-expiry', config.reservationExpiryIntervalMs, config.enabled);
  }

  protected async runOnce(): Promise<void> {
    const expired = await this.expireReservations.execute();
    if (expired > 0) {
      this.logger.log(`만료된 예약 ${expired}건을 회수했습니다.`);
    }
  }
}
