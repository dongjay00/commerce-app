import { Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { SchedulerRegistry } from '@nestjs/schedule';

/**
 * 주기 실행의 골격. 두 스케줄러(Outbox 릴레이, 예약 만료)가 이것을 상속한다.
 *
 * **`@Interval` 데코레이터를 쓰지 않는다.** 데코레이터 인자는 상수여야 해서
 * `SchedulerConfig`의 주기 값이 죽은 설정이 된다. `SchedulerRegistry`에
 * `onModuleInit`에서 등록하면 설정값을 쓸 수 있고, 무엇보다 **꺼져 있을 때
 * 아예 등록하지 않을 수 있다** — `tick` 안에서 검사하는 것보다 깨끗하다.
 * 타이머가 존재하지도 않으므로 테스트에서 배경 폴링이 원천적으로 없다.
 */
export abstract class IntervalScheduler implements OnModuleInit, OnModuleDestroy {
  protected readonly logger: Logger;
  private running = false;

  constructor(
    private readonly registry: SchedulerRegistry,
    private readonly name: string,
    private readonly intervalMs: number,
    private readonly enabled: boolean,
  ) {
    this.logger = new Logger(name);
  }

  onModuleInit(): void {
    if (!this.enabled) {
      this.logger.log(`스케줄러가 꺼져 있어 등록하지 않습니다: ${this.name}`);
      return;
    }
    const handle = setInterval(() => {
      void this.tick();
    }, this.intervalMs);
    this.registry.addInterval(this.name, handle);
    this.logger.log(`${this.intervalMs}ms 주기로 등록했습니다: ${this.name}`);
  }

  onModuleDestroy(): void {
    // 앱을 닫아도 타이머가 남으면 테스트 프로세스가 종료되지 않는다.
    if (this.registry.doesExist('interval', this.name)) {
      this.registry.deleteInterval(this.name);
    }
  }

  /** `protected`가 아니다 — 스펙이 타이머 없이 직접 부른다. */
  async tick(): Promise<void> {
    // 이전 실행이 아직 끝나지 않았으면 건너뛴다. 작업이 느려지면 주기가 겹치고,
    // 겹친 두 실행이 같은 행을 집어 같은 이벤트를 두 번 보낸다.
    // (at-least-once 계약상 허용되지만 이유 없이 늘릴 필요는 없다.)
    if (this.running) {
      this.logger.warn(`이전 실행이 끝나지 않아 이번 주기를 건너뜁니다: ${this.name}`);
      return;
    }
    this.running = true;
    try {
      await this.runOnce();
    } catch (error) {
      // 스케줄러가 죽으면 다음 주기가 오지 않는다. 반드시 삼킨다.
      this.logger.error(`${this.name} 실행 실패: ${String(error)}`);
    } finally {
      this.running = false;
    }
  }

  protected abstract runOnce(): Promise<void>;
}
