import { SchedulerRegistry } from '@nestjs/schedule';
import { afterEach, describe, expect, it } from 'vitest';
import type { SchedulerConfig } from '../../../../../shared/infrastructure/scheduler/scheduler.config';
import type { ExpireReservationsUseCase } from '../../../application/ports/in/expire-reservations.usecase';
import { ReservationExpiryScheduler } from './reservation-expiry.scheduler';

/** 손으로 쓴 fake — 호출 횟수를 세고, 옵션으로 던진다. */
class FakeExpireReservations implements ExpireReservationsUseCase {
  calls = 0;
  constructor(private readonly throws = false) {}
  async execute(): Promise<number> {
    this.calls += 1;
    if (this.throws) {
      throw new Error('의도적 실패');
    }
    return 3;
  }
}

const config = (enabled: boolean): SchedulerConfig => ({
  enabled,
  outboxRelayIntervalMs: 5_000,
  reservationExpiryIntervalMs: 1_000,
});

let scheduler: ReservationExpiryScheduler | undefined;

afterEach(() => {
  scheduler?.onModuleDestroy();
  scheduler = undefined;
});

describe('ReservationExpiryScheduler', () => {
  it('켜져 있으면 자기 이름으로 인터벌을 등록한다', () => {
    const registry = new SchedulerRegistry();
    scheduler = new ReservationExpiryScheduler(
      registry,
      config(true),
      new FakeExpireReservations(),
    );

    scheduler.onModuleInit();

    expect(registry.doesExist('interval', 'reservation-expiry')).toBe(true);
  });

  it('꺼져 있으면 등록하지 않는다', () => {
    const registry = new SchedulerRegistry();
    scheduler = new ReservationExpiryScheduler(
      registry,
      config(false),
      new FakeExpireReservations(),
    );

    scheduler.onModuleInit();

    expect(registry.doesExist('interval', 'reservation-expiry')).toBe(false);
  });

  it('tick이 만료 유스케이스를 부른다', async () => {
    const usecase = new FakeExpireReservations();
    scheduler = new ReservationExpiryScheduler(new SchedulerRegistry(), config(true), usecase);

    await scheduler.tick();

    expect(usecase.calls).toBe(1);
  });

  it('만료가 던져도 tick이 던지지 않는다', async () => {
    // TTL 자가치유가 한 번의 실패로 영영 멈추면, 그 사실은 재고가 예약 상태로
    // 쌓인 뒤에야 드러난다.
    const usecase = new FakeExpireReservations(true);
    scheduler = new ReservationExpiryScheduler(new SchedulerRegistry(), config(true), usecase);

    await expect(scheduler.tick()).resolves.toBeUndefined();
    expect(usecase.calls).toBe(1);
  });
});
