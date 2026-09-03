import { SchedulerRegistry } from '@nestjs/schedule';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IntervalScheduler } from './interval-scheduler';

/**
 * 손으로 쓴 fake다 — `vi.mock`을 쓰지 않는다. 호출 횟수를 세고, 옵션으로 던지거나
 * 지연된다. 스케줄러가 부르는 대상의 성질을 바꿔가며 골격을 검사하는 것이 목적이다.
 */
class SpyScheduler extends IntervalScheduler {
  calls = 0;
  private resolveGate?: () => void;

  constructor(
    registry: SchedulerRegistry,
    enabled: boolean,
    private readonly behaviour: 'ok' | 'throws' | 'hangs' = 'ok',
    intervalMs = 1_000,
  ) {
    super(registry, 'spy', intervalMs, enabled);
  }

  /** `hangs`일 때 매달린 실행을 풀어준다. */
  release(): void {
    this.resolveGate?.();
  }

  protected async runOnce(): Promise<void> {
    this.calls += 1;
    if (this.behaviour === 'throws') {
      throw new Error('의도적 실패');
    }
    if (this.behaviour === 'hangs') {
      await new Promise<void>((resolve) => {
        this.resolveGate = resolve;
      });
    }
  }
}

let scheduler: SpyScheduler | undefined;

afterEach(() => {
  scheduler?.onModuleDestroy();
  scheduler?.release();
  scheduler = undefined;
  vi.useRealTimers();
});

describe('IntervalScheduler', () => {
  it('꺼져 있으면 인터벌을 아예 등록하지 않는다', () => {
    // `tick` 안에서 검사하는 대신 등록 자체를 하지 않는다 — 타이머가 존재하지
    // 않으므로 테스트에서 배경 폴링이 원천적으로 없다.
    const registry = new SchedulerRegistry();
    scheduler = new SpyScheduler(registry, false);

    scheduler.onModuleInit();

    expect(registry.doesExist('interval', 'spy')).toBe(false);
  });

  it('꺼져 있으면 시간이 흘러도 작업을 부르지 않는다', () => {
    vi.useFakeTimers();
    const registry = new SchedulerRegistry();
    scheduler = new SpyScheduler(registry, false);
    scheduler.onModuleInit();

    vi.advanceTimersByTime(10_000);

    expect(scheduler.calls).toBe(0);
  });

  it('켜져 있으면 주기마다 작업을 부른다', async () => {
    vi.useFakeTimers();
    const registry = new SchedulerRegistry();
    scheduler = new SpyScheduler(registry, true, 'ok', 1_000);
    scheduler.onModuleInit();

    expect(registry.doesExist('interval', 'spy')).toBe(true);
    await vi.advanceTimersByTimeAsync(3_000);

    expect(scheduler.calls).toBe(3);
  });

  it('작업이 던져도 tick이 던지지 않는다', async () => {
    // 이 회귀는 한 번의 실패로 스케줄러를 영영 멈춘다 — 그리고 TTL 자가치유가
    // 멈췄다는 사실은 재고가 쌓인 뒤에야 드러난다.
    const registry = new SchedulerRegistry();
    scheduler = new SpyScheduler(registry, true, 'throws');

    await expect(scheduler.tick()).resolves.toBeUndefined();
    expect(scheduler.calls).toBe(1);

    // 그리고 다음 주기가 정상적으로 온다.
    await scheduler.tick();
    expect(scheduler.calls).toBe(2);
  });

  it('이전 실행이 끝나기 전에 다시 불리면 두 번째는 작업을 부르지 않는다', async () => {
    const registry = new SchedulerRegistry();
    scheduler = new SpyScheduler(registry, true, 'hangs');

    const first = scheduler.tick();
    await scheduler.tick(); // 겹친 호출
    expect(scheduler.calls).toBe(1);

    scheduler.release();
    await first;

    // 첫 실행이 끝난 뒤에는 다시 부른다.
    const second = scheduler.tick();
    scheduler.release();
    await second;
    expect(scheduler.calls).toBe(2);
  });

  it('onModuleDestroy가 인터벌을 해제한다', () => {
    // 앱을 닫아도 타이머가 남으면 테스트 프로세스가 종료되지 않는다.
    const registry = new SchedulerRegistry();
    scheduler = new SpyScheduler(registry, true);
    scheduler.onModuleInit();

    scheduler.onModuleDestroy();

    expect(registry.doesExist('interval', 'spy')).toBe(false);
  });
});
