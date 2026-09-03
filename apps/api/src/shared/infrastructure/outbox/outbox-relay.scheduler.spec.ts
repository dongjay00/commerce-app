import { SchedulerRegistry } from '@nestjs/schedule';
import { afterEach, describe, expect, it } from 'vitest';
import type { SchedulerConfig } from '../scheduler/scheduler.config';
import type { OutboxRelay } from './outbox-relay';
import { OutboxRelayScheduler } from './outbox-relay.scheduler';

/** 손으로 쓴 fake — 호출 횟수만 센다. */
class FakeRelay {
  calls = 0;
  async relayOnce(): Promise<number> {
    this.calls += 1;
    return 2;
  }
}

const config = (enabled: boolean): SchedulerConfig => ({
  enabled,
  outboxRelayIntervalMs: 1_000,
  reservationExpiryIntervalMs: 30_000,
});

let scheduler: OutboxRelayScheduler | undefined;

afterEach(() => {
  scheduler?.onModuleDestroy();
  scheduler = undefined;
});

describe('OutboxRelayScheduler', () => {
  it('켜져 있으면 자기 이름으로 인터벌을 등록한다', () => {
    // 생성자 인자 순서가 뒤바뀌면 타입 검사는 통과하고 런타임에만 깨진다.
    // 통합 스위트는 주기가 5초라 앱 수명 안에서 틱이 거의 뜨지 않아 이것을 못 잡는다.
    const registry = new SchedulerRegistry();
    scheduler = new OutboxRelayScheduler(
      registry,
      config(true),
      new FakeRelay() as unknown as OutboxRelay,
    );

    scheduler.onModuleInit();

    expect(registry.doesExist('interval', 'outbox-relay')).toBe(true);
  });

  it('꺼져 있으면 등록하지 않는다', () => {
    const registry = new SchedulerRegistry();
    scheduler = new OutboxRelayScheduler(
      registry,
      config(false),
      new FakeRelay() as unknown as OutboxRelay,
    );

    scheduler.onModuleInit();

    expect(registry.doesExist('interval', 'outbox-relay')).toBe(false);
  });

  it('tick이 릴레이를 정확히 한 번 부른다', async () => {
    const relay = new FakeRelay();
    scheduler = new OutboxRelayScheduler(
      new SchedulerRegistry(),
      config(true),
      relay as unknown as OutboxRelay,
    );

    await scheduler.tick();

    expect(relay.calls).toBe(1);
  });
});
