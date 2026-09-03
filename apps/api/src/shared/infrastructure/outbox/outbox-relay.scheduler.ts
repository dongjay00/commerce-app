import { Injectable } from '@nestjs/common';
// biome-ignore lint/style/useImportType: Nest DI가 design:paramtypes 런타임 값을 요구한다.
import { SchedulerRegistry } from '@nestjs/schedule';
import { IntervalScheduler } from '../scheduler/interval-scheduler';
import type { SchedulerConfig } from '../scheduler/scheduler.config';
// biome-ignore lint/style/useImportType: 같은 이유로 런타임 값이 필요하다.
import { OutboxRelay } from './outbox-relay';

/**
 * `OutboxRelay`의 **첫 프로덕션 호출자다.**
 *
 * 계획 1이 릴레이를 만든 뒤 이것을 부르는 코드가 한 번도 없었다 — 그래서 이벤트를
 * outbox에 넣는 모든 코드가 지금까지 아무 데도 도착하지 않았다. 태스크 9의
 * `StockReservationExpired`가 이 계획에서 처음 발행되는 이벤트이고, 여기가 그 길이다.
 */
@Injectable()
export class OutboxRelayScheduler extends IntervalScheduler {
  constructor(
    registry: SchedulerRegistry,
    config: SchedulerConfig,
    private readonly relay: OutboxRelay,
  ) {
    super(registry, 'outbox-relay', config.outboxRelayIntervalMs, config.enabled);
  }

  protected async runOnce(): Promise<void> {
    const sent = await this.relay.relayOnce();
    if (sent > 0) {
      this.logger.log(`이벤트 ${sent}건을 발행했습니다.`);
    }
  }
}
